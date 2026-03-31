/**
 * Database config - MySQL (Railway addon or external)
 * Aceita: DATABASE_URL (mysql://user:pass@host:port/db) ou DB_HOST + DB_USER + DB_PASS + DB_NAME
 */
import mysql from 'mysql2/promise';

let pool = null;

/** Ligações MySQL fechadas pelo servidor (idle) — recriar pool. */
export function isTransientMysqlError(err) {
  if (!err) return false;
  const c = err.code;
  return (
    c === 'PROTOCOL_CONNECTION_LOST' ||
    c === 'ECONNRESET' ||
    c === 'ETIMEDOUT' ||
    c === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' ||
    c === 'EPIPE' ||
    err.fatal === true
  );
}

export async function resetDbPool() {
  if (pool) {
    try {
      await pool.end();
    } catch (_) {
      /* ignore */
    }
    pool = null;
  }
}

function parseDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = url.startsWith('mysql') ? url : 'mysql://' + url.replace(/^\/\//, '');
    const parsed = new URL(u);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 3306,
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '').replace(/\?.*$/, '') || 'railway',
    };
  } catch (_) {
    return null;
  }
}

function isLocalMysqlHost(host) {
  if (!host || typeof host !== 'string') return false;
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** Variáveis do plugin MySQL no Railway (serviço Node referencia o MySQL). */
function mysqlPluginConfigFromEnv() {
  const host = process.env.MYSQLHOST || process.env.MYSQL_HOST;
  const user = process.env.MYSQLUSER || process.env.MYSQL_USER;
  const database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE;
  if (!host?.trim() || !user?.trim() || !database?.trim()) return null;
  const password =
    process.env.MYSQLPASSWORD ||
    process.env.MYSQL_PASSWORD ||
    process.env.MYSQL_ROOT_PASSWORD ||
    '';
  return {
    host: host.trim(),
    port: parseInt(process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306', 10) || 3306,
    user: user.trim(),
    password,
    database: database.trim(),
  };
}

function isDatabaseConfigured() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.MYSQL_URL;
  if (url?.trim()) {
    const fromUrl = parseDatabaseUrl(url);
    if (fromUrl && fromUrl.user && fromUrl.database) return true;
  }
  if (mysqlPluginConfigFromEnv()) return true;
  const user = process.env.DB_USER || '';
  const pass = process.env.DB_PASS || '';
  const name = process.env.DB_NAME || '';
  const noPlaceholder = (s) => s && !/SEU_USUARIO|SUA_SENHA|your_db/i.test(s);
  return Boolean(
    process.env.DB_HOST?.trim() &&
      noPlaceholder(user) &&
      noPlaceholder(pass) &&
      noPlaceholder(name)
  );
}

/**
 * Config MySQL única para pool (app) e scripts (migrate).
 * Ordem: DATABASE_URL (etc.) se útil; se a URL aponta para localhost mas DB_HOST é remoto, usa DB_* (evita URL velha no shell / .env).
 * Depois DB_* ; depois MYSQLHOST / MYSQLUSER… (Railway).
 * localhost → 127.0.0.1 para evitar ::1 no macOS sem listener IPv6.
 */
export function getMysqlConnectionConfig() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.MYSQL_URL;
  const fromUrl = parseDatabaseUrl(url);
  const hasExplicitDb =
    Boolean(process.env.DB_HOST?.trim()) &&
    Boolean(process.env.DB_USER?.trim()) &&
    Boolean(process.env.DB_NAME?.trim());

  const urlLooksLocal = fromUrl && isLocalMysqlHost(fromUrl.host);
  const preferExplicitOverLocalUrl =
    hasExplicitDb && urlLooksLocal && !isLocalMysqlHost(process.env.DB_HOST);

  let cfg = null;
  if (fromUrl && fromUrl.user && fromUrl.database && !preferExplicitOverLocalUrl) {
    cfg = { ...fromUrl };
  } else if (hasExplicitDb) {
    cfg = {
      host: process.env.DB_HOST.trim(),
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER.trim(),
      password: process.env.DB_PASS ?? '',
      database: process.env.DB_NAME.trim(),
    };
  } else {
    cfg = mysqlPluginConfigFromEnv();
  }
  if (!cfg) return null;
  const h = (cfg.host || '').trim();
  if (h === 'localhost' || h === '::1') cfg = { ...cfg, host: '127.0.0.1' };
  return cfg;
}

/** Para scripts (migrate): o que falta sem expor segredos. */
export function getMysqlEnvDiagnostics() {
  const url =
    process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.MYSQL_URL;
  const fromUrl = parseDatabaseUrl(url);
  const urlLooksLocal = Boolean(fromUrl && isLocalMysqlHost(fromUrl.host));
  const explicitRemote =
    Boolean(process.env.DB_HOST?.trim()) && !isLocalMysqlHost(process.env.DB_HOST);
  return {
    urlSet: Boolean(url?.trim()),
    urlParsesOk: Boolean(fromUrl && fromUrl.user && fromUrl.database),
    urlHostLocal: urlLooksLocal,
    urlOvertakenByDbHost: urlLooksLocal && explicitRemote,
    dbHost: Boolean(process.env.DB_HOST?.trim()),
    dbUser: Boolean(process.env.DB_USER?.trim()),
    dbName: Boolean(process.env.DB_NAME?.trim()),
    dbPassSet: process.env.DB_PASS !== undefined && process.env.DB_PASS !== null,
  };
}

function getConfig() {
  return getMysqlConnectionConfig();
}

/** Host/port/db para logs e healthcheck (sem credenciais). */
export function getMysqlConnectionTargetInfo() {
  const cfg = getMysqlConnectionConfig();
  if (!cfg) return { configured: false, host: null, port: null, database: null };
  return {
    configured: true,
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
  };
}

/**
 * Confirma que o pool consegue uma ligação real (createPool é lazy).
 * @param {import('mysql2/promise').Pool} pool
 */
export async function verifyMysqlPoolConnectivity(pool, { attempts = 6, delayMs = 4000 } = {}) {
  if (!pool) return { ok: false, error: new Error('no_pool') };
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await pool.query('SELECT 1 AS ping');
      return { ok: true };
    } catch (e) {
      lastErr = e;
      console.error(`[db] MySQL ping ${i + 1}/${attempts}: ${e.code || e.message}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { ok: false, error: lastErr };
}

async function getDBConnection() {
  if (!isDatabaseConfigured()) return null;
  if (pool) return pool;
  const config = getConfig();
  if (!config) return null;
  try {
    pool = mysql.createPool({
      ...config,
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: true,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
    return pool;
  } catch (e) {
    console.error('DB connection error:', e.message);
    return null;
  }
}

export { isDatabaseConfigured, getDBConnection };
