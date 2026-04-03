/**
 * Completa `projects` + cria project_costs, project_materials, project_checklist, project_photos.
 * Idempotente: só ADD COLUMN / CREATE IF NOT EXISTS. Nunca DROP TABLE.
 * Run: npm run migrate:projects-complete
 */
import dotenv from 'dotenv';
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

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

async function tableExists(conn, name) {
  const [t] = await conn.query('SHOW TABLES LIKE ?', [name]);
  return t && t.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [indexName]);
  return rows && rows.length > 0;
}

async function addColumn(conn, table, ddl) {
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
}

async function tryQuery(conn, sql, label) {
  try {
    await conn.query(sql);
    if (label) console.log('  +', label);
  } catch (e) {
    console.warn('  ! skip:', label || sql.slice(0, 60), '-', e.message);
  }
}

async function migrateProjectsTable(conn) {
  if (!(await tableExists(conn, 'projects'))) {
    console.error('[migrate] Tabela projects não existe — crie a base CRM primeiro.');
    process.exit(1);
  }

  const [colRows] = await conn.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
  );
  const colMap = Object.fromEntries(colRows.map((r) => [r.COLUMN_NAME, r]));

  if (colMap.customer_id && colMap.customer_id.IS_NULLABLE === 'NO') {
    await tryQuery(conn, 'ALTER TABLE `projects` MODIFY COLUMN `customer_id` INT NULL', 'customer_id NULL');
  }

  const additions = [
    ['estimate_id', "`estimate_id` INT NULL COMMENT 'FK estimates'"],
    ['contract_id', "`contract_id` INT NULL"],
    ['client_type', "`client_type` ENUM('builder','customer') NOT NULL DEFAULT 'customer'"],
    ['builder_id', '`builder_id` INT NULL'],
    ['builder_name', '`builder_name` VARCHAR(255) NULL'],
    ['project_number', '`project_number` VARCHAR(50) NULL COMMENT 'PRJ-YYYY-NNN'"],
    ['flooring_type', '`flooring_type` VARCHAR(100) NULL'],
    ['total_sqft', '`total_sqft` DECIMAL(10,2) NULL'],
    [
      'service_type',
      "`service_type` SET('supply','installation','sand_finish') NOT NULL DEFAULT 'installation'",
    ],
    ['contract_value', '`contract_value` DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
    ['supply_value', '`supply_value` DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
    ['installation_value', '`installation_value` DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
    ['sand_finish_value', '`sand_finish_value` DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
    ['labor_cost_actual', '`labor_cost_actual` DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
    ['material_cost_actual', '`material_cost_actual` DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
    ['additional_cost_actual', '`additional_cost_actual` DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
    ['start_date', '`start_date` DATE NULL'],
    ['end_date_estimated', '`end_date_estimated` DATE NULL'],
    ['end_date_actual', '`end_date_actual` DATE NULL'],
    ['days_estimated', '`days_estimated` INT NULL'],
    ['days_actual', '`days_actual` INT NULL'],
    ['completion_percentage', '`completion_percentage` INT NOT NULL DEFAULT 0'],
    ['checklist_completed', '`checklist_completed` TINYINT(1) NOT NULL DEFAULT 0'],
    ['checklist_completed_at', '`checklist_completed_at` TIMESTAMP NULL'],
    ['checklist_completed_by', '`checklist_completed_by` INT NULL'],
    ['crew_id', '`crew_id` INT NULL'],
    ['assigned_to', '`assigned_to` INT NULL'],
    ['internal_notes', '`internal_notes` TEXT NULL'],
    ['created_by', '`created_by` INT NULL'],
    ['deleted_at', '`deleted_at` TIMESTAMP NULL'],
  ];

  for (const [name, ddl] of additions) {
    if (!(await columnExists(conn, 'projects', name))) {
      await addColumn(conn, 'projects', ddl);
      console.log('  + column projects.', name);
    }
  }

  if ((await columnExists(conn, 'projects', 'assigned_to')) && colMap.owner_id) {
    await tryQuery(
      conn,
      'UPDATE `projects` SET `assigned_to` = `owner_id` WHERE `assigned_to` IS NULL AND `owner_id` IS NOT NULL',
      'backfill assigned_to from owner_id'
    );
  }

  if ((await columnExists(conn, 'projects', 'start_date')) && colMap.estimated_start_date) {
    await tryQuery(
      conn,
      'UPDATE `projects` SET `start_date` = `estimated_start_date` WHERE `start_date` IS NULL AND `estimated_start_date` IS NOT NULL',
      'backfill start_date'
    );
  }
  if ((await columnExists(conn, 'projects', 'end_date_estimated')) && colMap.estimated_end_date) {
    await tryQuery(
      conn,
      'UPDATE `projects` SET `end_date_estimated` = `estimated_end_date` WHERE `end_date_estimated` IS NULL AND `estimated_end_date` IS NOT NULL',
      'backfill end_date_estimated'
    );
  }
  if ((await columnExists(conn, 'projects', 'contract_value')) && colMap.estimated_cost) {
    await tryQuery(
      conn,
      'UPDATE `projects` SET `contract_value` = COALESCE(`estimated_cost`,0) WHERE (`contract_value` IS NULL OR `contract_value` = 0) AND `estimated_cost` IS NOT NULL',
      'backfill contract_value from estimated_cost'
    );
  }

  const [stRow] = await conn.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'status'`
  );
  const stType = String(stRow[0]?.COLUMN_TYPE || '');
  if (stType.includes('quoted')) {
    try {
      await conn.query(
        `ALTER TABLE \`projects\` MODIFY COLUMN \`status\` VARCHAR(32) NOT NULL DEFAULT 'scheduled'`
      );
      await conn.query(`UPDATE \`projects\` SET \`status\` = 'scheduled' WHERE \`status\` = 'quoted'`);
      await conn.query(
        `UPDATE \`projects\` SET \`status\` = 'scheduled' WHERE \`status\` NOT IN ('scheduled','in_progress','on_hold','completed','cancelled')`
      );
      await conn.query(
        `ALTER TABLE \`projects\` MODIFY COLUMN \`status\` ENUM('scheduled','in_progress','on_hold','completed','cancelled') NOT NULL DEFAULT 'scheduled'`
      );
      console.log('  + projects.status enum atualizado');
    } catch (e) {
      console.warn('  ! status migration:', e.message);
    }
  }

  if (!(await indexExists(conn, 'projects', 'uq_projects_project_number'))) {
    await tryQuery(
      conn,
      'ALTER TABLE `projects` ADD UNIQUE KEY `uq_projects_project_number` (`project_number`)',
      'UNIQUE project_number'
    );
  }

  if ((await tableExists(conn, 'estimates')) && (await columnExists(conn, 'projects', 'estimate_id'))) {
    await tryQuery(
      conn,
      `ALTER TABLE \`projects\`
       ADD CONSTRAINT \`fk_projects_estimate\` FOREIGN KEY (\`estimate_id\`) REFERENCES \`estimates\` (\`id\`) ON DELETE SET NULL`,
      'FK projects.estimate_id'
    );
  }
  if ((await tableExists(conn, 'contracts')) && (await columnExists(conn, 'projects', 'contract_id'))) {
    await tryQuery(
      conn,
      `ALTER TABLE \`projects\`
       ADD CONSTRAINT \`fk_projects_contract_new\` FOREIGN KEY (\`contract_id\`) REFERENCES \`contracts\` (\`id\`) ON DELETE SET NULL`,
      'FK projects.contract_id'
    );
  }
  if ((await tableExists(conn, 'users')) && (await columnExists(conn, 'projects', 'created_by'))) {
    await tryQuery(
      conn,
      `ALTER TABLE \`projects\`
       ADD CONSTRAINT \`fk_projects_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL`,
      'FK projects.created_by'
    );
  }
  if ((await tableExists(conn, 'users')) && (await columnExists(conn, 'projects', 'checklist_completed_by'))) {
    await tryQuery(
      conn,
      `ALTER TABLE \`projects\`
       ADD CONSTRAINT \`fk_projects_checklist_by\` FOREIGN KEY (\`checklist_completed_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL`,
      'FK projects.checklist_completed_by'
    );
  }
  if ((await tableExists(conn, 'crews')) && (await columnExists(conn, 'projects', 'crew_id'))) {
    await tryQuery(
      conn,
      `ALTER TABLE \`projects\`
       ADD CONSTRAINT \`fk_projects_crew\` FOREIGN KEY (\`crew_id\`) REFERENCES \`crews\` (\`id\`) ON DELETE SET NULL`,
      'FK projects.crew_id'
    );
  }
}

async function createChildTables(conn) {
  await conn.query(`
CREATE TABLE IF NOT EXISTS \`project_costs\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`cost_type\` ENUM('labor','material','additional') NOT NULL,
  \`service_category\` ENUM('supply','installation','sand_finish','general') NOT NULL DEFAULT 'general',
  \`description\` VARCHAR(255) NOT NULL,
  \`quantity\` DECIMAL(10,2) NOT NULL DEFAULT 1,
  \`unit\` VARCHAR(50) NULL,
  \`unit_cost\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`total_cost\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`paid\` TINYINT(1) NOT NULL DEFAULT 0,
  \`paid_at\` DATE NULL,
  \`vendor\` VARCHAR(255) NULL,
  \`receipt_path\` VARCHAR(500) NULL,
  \`notes\` TEXT NULL,
  \`created_by\` INT NULL,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_project_costs_project\` (\`project_id\`),
  KEY \`idx_project_costs_type\` (\`cost_type\`),
  CONSTRAINT \`fk_project_costs_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

  await conn.query(`
CREATE TABLE IF NOT EXISTS \`project_materials\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`product_name\` VARCHAR(255) NOT NULL,
  \`sku\` VARCHAR(100) NULL,
  \`supplier\` VARCHAR(255) NULL,
  \`unit\` VARCHAR(50) NULL,
  \`qty_ordered\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`qty_received\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`qty_used\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`unit_cost\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`total_cost\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`service_category\` ENUM('supply','installation','sand_finish','general') NOT NULL DEFAULT 'general',
  \`status\` ENUM('pending','ordered','received','partial','returned') NOT NULL DEFAULT 'pending',
  \`order_date\` DATE NULL,
  \`received_date\` DATE NULL,
  \`notes\` TEXT NULL,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_project_materials_project\` (\`project_id\`),
  CONSTRAINT \`fk_project_materials_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

  await conn.query(`
CREATE TABLE IF NOT EXISTS \`project_checklist\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`category\` VARCHAR(100) NOT NULL,
  \`item\` VARCHAR(255) NOT NULL,
  \`checked\` TINYINT(1) NOT NULL DEFAULT 0,
  \`checked_by\` INT NULL,
  \`checked_at\` TIMESTAMP NULL,
  \`notes\` TEXT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_project_checklist_project\` (\`project_id\`),
  CONSTRAINT \`fk_project_checklist_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

  await conn.query(`
CREATE TABLE IF NOT EXISTS \`project_photos\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`phase\` ENUM('before','during','after') NOT NULL DEFAULT 'during',
  \`filename\` VARCHAR(255) NOT NULL,
  \`original_name\` VARCHAR(255) NULL,
  \`file_path\` VARCHAR(500) NOT NULL,
  \`file_size\` INT NULL,
  \`mime_type\` VARCHAR(100) NULL,
  \`caption\` VARCHAR(255) NULL,
  \`taken_at\` TIMESTAMP NULL,
  \`uploaded_by\` INT NULL,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_project_photos_project\` (\`project_id\`),
  CONSTRAINT \`fk_project_photos_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

  console.log('  + tabelas project_costs, project_materials, project_checklist, project_photos (IF NOT EXISTS)');
}

async function main() {
  const base = applyRailwayTcpProxyIfNeeded(getMysqlConnectionConfig());
  if (!base) {
    console.error('[migrate] Sem MySQL.', getMysqlEnvDiagnostics());
    process.exit(1);
  }
  const conn = await mysql.createConnection({ ...base, multipleStatements: true });
  console.log('[migrate:projects-complete] projects + filhos…');
  await migrateProjectsTable(conn);
  await createChildTables(conn);
  await conn.end();
  console.log('[migrate:projects-complete] concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
