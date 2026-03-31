/**
 * Quotes module v2: catalog, templates, snapshots, public flow fields.
 * Idempotent. Run: node database/migrate-quotes-module-complete.js
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function addColumn(conn, table, ddl) {
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  console.log('Quotes module complete migration…');

  const quoteCols = [
    ['assigned_to', '`assigned_to` INT NULL DEFAULT NULL COMMENT "User id (sales)"'],
    [
      'service_type',
      '`service_type` VARCHAR(64) NULL DEFAULT NULL COMMENT "Installation, Sand & Finishing"',
    ],
    ['terms_conditions', '`terms_conditions` TEXT NULL'],
    ['email_sent_at', '`email_sent_at` DATETIME NULL DEFAULT NULL'],
  ];
  for (const [name, ddl] of quoteCols) {
    if (!(await columnExists(conn, 'quotes', name))) {
      await addColumn(conn, 'quotes', ddl);
      console.log('  + quotes.' + name);
    }
  }

  const itemCols = [
    ['service_catalog_id', '`service_catalog_id` INT NULL DEFAULT NULL'],
    [
      'unit_type',
      "`unit_type` ENUM('sq_ft','linear_ft','inches','fixed') NOT NULL DEFAULT 'sq_ft'",
    ],
    ['sort_order', '`sort_order` INT NOT NULL DEFAULT 0'],
  ];
  for (const [name, ddl] of itemCols) {
    if (!(await columnExists(conn, 'quote_items', name))) {
      await addColumn(conn, 'quote_items', ddl);
      console.log('  + quote_items.' + name);
    }
  }

  try {
    await conn.query(
      "ALTER TABLE `quote_items` MODIFY `floor_type` VARCHAR(100) NOT NULL DEFAULT 'General'"
    );
    console.log('  ✓ quote_items.floor_type default General');
  } catch (e) {
    console.warn('  (skip floor_type alter)', e.message);
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_service_catalog (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(64) NOT NULL COMMENT 'Installation, Sand & Finishing',
      default_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
      unit_type ENUM('sq_ft','linear_ft','inches','fixed') NOT NULL DEFAULT 'sq_ft',
      default_description TEXT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_qsc_category (category),
      KEY idx_qsc_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ quote_service_catalog');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      service_type VARCHAR(64) NULL,
      created_by INT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_qtpl_created_by (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ quote_templates');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_template_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      service_catalog_id INT NULL,
      description TEXT NOT NULL,
      unit_type ENUM('sq_ft','linear_ft','inches','fixed') NOT NULL DEFAULT 'sq_ft',
      quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
      rate DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      KEY idx_qti_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ quote_template_items');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quote_id INT NOT NULL,
      snapshot_json LONGTEXT NOT NULL,
      created_by INT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_qsnap_quote (quote_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ quote_snapshots');

  const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM quote_service_catalog');
  if (cnt === 0) {
    await conn.query(`
      INSERT INTO quote_service_catalog (name, category, default_rate, unit_type, default_description, active) VALUES
      ('Hardwood install — labor', 'Installation', 4.50, 'sq_ft', 'Per sq ft — nail-down / glue assist', 1),
      ('LVP / LVP install — labor', 'Installation', 3.25, 'sq_ft', 'Floating or glue-down LVP', 1),
      ('Screen & recoat', 'Sand & Finishing', 2.75, 'sq_ft', 'Maintenance coat when sanding not required', 1),
      ('Full sand & finish (2 coats)', 'Sand & Finishing', 5.50, 'sq_ft', 'Dust-controlled sanding + finish system', 1),
      ('Trip charge / minimum', 'Installation', 250.00, 'fixed', 'Small job minimum', 1)
    `);
    console.log('  ✓ seeded quote_service_catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
