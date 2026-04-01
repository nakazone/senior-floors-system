/**
 * Construction payroll module — schema + permissions.
 * Idempotent for permissions. Run: npm run migrate:construction-payroll
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { getMysqlConnectionConfig, getMysqlEnvDiagnostics } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const envInjectedByRailway =
  Boolean(process.env.RAILWAY_PROJECT_ID) ||
  Boolean(process.env.MYSQL_URL?.trim()) ||
  Boolean(process.env.MYSQLHOST?.trim());
if (!envInjectedByRailway) {
  dotenv.config({ path: envPath, override: true });
}

function applyRailwayTcpProxyIfNeeded(cfg) {
  if (!cfg) return null;
  const ph = process.env.RAILWAY_TCP_PROXY_DOMAIN?.trim();
  const pp = process.env.RAILWAY_TCP_PROXY_PORT?.trim();
  if (!ph || !pp) return cfg;
  const h = (cfg.host || '').trim().toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return cfg;
  const railwayHost =
    h.endsWith('.railway.internal') || h.endsWith('.up.railway.app') || h.includes('.railway.app');
  if (!railwayHost) return cfg;
  return { ...cfg, host: ph, port: parseInt(pp, 10) || cfg.port };
}

async function ensurePermission(conn, key, name, group, description) {
  const [rows] = await conn.query('SELECT id FROM permissions WHERE permission_key = ? LIMIT 1', [key]);
  if (rows.length) return;
  await conn.query(
    `INSERT INTO permissions (permission_key, permission_name, permission_group, description)
     VALUES (?, ?, ?, ?)`,
    [key, name, group, description]
  );
  console.log('  + permission:', key);
}

async function main() {
  const base = applyRailwayTcpProxyIfNeeded(getMysqlConnectionConfig());
  if (!base) {
    console.error('Sem configuração MySQL válida.', getMysqlEnvDiagnostics());
    process.exit(1);
  }
  const conn = await mysql.createConnection({ ...base, multipleStatements: true });

  const sqlPath = path.join(__dirname, 'schema-construction-payroll.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('migrate-construction-payroll: aplicando DDL…');
  await conn.query(sql);

  console.log('migrate-construction-payroll: permissões…');
  await ensurePermission(
    conn,
    'payroll.view',
    'Construction payroll (view)',
    'payroll',
    'Ver funcionários de obra, períodos, timesheets e relatórios'
  );
  await ensurePermission(
    conn,
    'payroll.manage',
    'Construction payroll (manage)',
    'payroll',
    'Criar/editar funcionários, períodos, timesheets e fechar folha'
  );

  await conn.end();
  console.log('migrate-construction-payroll: concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
