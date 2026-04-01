/**
 * Garante coluna customers.lead_id (FK lógica ao lead convertido).
 * Idempotente. Railway: railway run node database/migrate-customers-lead-id.js
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

async function columnExists(conn, table, col) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return rows[0].c > 0;
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (!url) {
    console.error('Defina DATABASE_URL ou MYSQL_URL.');
    process.exit(1);
  }
  const conn = await mysql.createConnection(url);
  try {
    if (await columnExists(conn, 'customers', 'lead_id')) {
      console.log('Coluna customers.lead_id já existe.');
      return;
    }
    await conn.query(`
      ALTER TABLE customers
      ADD COLUMN lead_id INT NULL DEFAULT NULL COMMENT 'Lead de origem (conversão CRM)'
      AFTER id
    `);
    console.log('Coluna customers.lead_id criada.');
    try {
      await conn.query(
        'CREATE INDEX idx_customers_lead_id ON customers (lead_id)'
      );
      console.log('Índice idx_customers_lead_id criado.');
    } catch (e) {
      if (!String(e.message || '').includes('Duplicate')) console.warn(e.message);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
