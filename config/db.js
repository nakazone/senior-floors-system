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

function isDatabaseConfigured() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.MYSQL_URL;
  if (url) return true;
  const user = process.env.DB_USER || '';
  const pass = process.env.DB_PASS || '';
  const name = process.env.DB_NAME || '';
  const noPlaceholder = (s) => s && !/SEU_USUARIO|SUA_SENHA|your_db/i.test(s);
  return noPlaceholder(user) && noPlaceholder(pass) && noPlaceholder(name);
}

function getConfig() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.MYSQL_URL;
  const fromUrl = parseDatabaseUrl(url);
  if (fromUrl && fromUrl.user && fromUrl.database) return fromUrl;
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS && process.env.DB_NAME) {
    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    };
  }
  return null;
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
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 20000,
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
