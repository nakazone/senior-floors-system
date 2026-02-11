/**
 * Garante que a tabela interactions existe e aceita todos os tipos (call, whatsapp, email, visit, meeting).
 * Execute uma vez: node database/run-ensure-interactions.js (com .env)
 * Ou no Railway: railway run node database/run-ensure-interactions.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function getMySQLConfig() {
  if (process.env.DATABASE_PUBLIC_URL) {
    const url = new URL(process.env.DATABASE_PUBLIC_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
    };
  }
  if (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT) {
    return {
      host: process.env.RAILWAY_TCP_PROXY_DOMAIN,
      port: parseInt(process.env.RAILWAY_TCP_PROXY_PORT),
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
    };
  }
  if (process.env.MYSQLHOST) {
    return {
      host: process.env.MYSQLHOST,
      port: parseInt(process.env.MYSQLPORT) || 3306,
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQLDATABASE || 'railway',
    };
  }
  if (process.env.DB_HOST) {
    return {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME || 'railway',
    };
  }
  return null;
}

const createTableSql = `
CREATE TABLE IF NOT EXISTS interactions (
  id int(11) NOT NULL AUTO_INCREMENT,
  lead_id int(11) NOT NULL,
  user_id int(11) DEFAULT NULL,
  type varchar(50) NOT NULL COMMENT 'call, whatsapp, email, visit, meeting',
  subject varchar(255) DEFAULT NULL,
  notes text DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_id (lead_id),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

async function main() {
  const config = getMySQLConfig();
  if (!config) {
    console.error('No database config. Set DATABASE_PUBLIC_URL or DB_* / MYSQL* env vars.');
    process.exit(1);
  }
  console.log('Connecting to MySQL...');
  const conn = await mysql.createConnection(config);
  try {
    await conn.execute(createTableSql);
    console.log('Table interactions ensured (CREATE TABLE IF NOT EXISTS).');

    const [cols] = await conn.execute("SHOW COLUMNS FROM interactions WHERE Field = 'type'");
    if (cols.length > 0 && cols[0].Type && String(cols[0].Type).toLowerCase().includes('enum')) {
      await conn.execute('ALTER TABLE interactions MODIFY type VARCHAR(50) NOT NULL');
      console.log('Column type changed from ENUM to VARCHAR(50) to accept "meeting".');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
