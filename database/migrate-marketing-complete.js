/**
 * Completa ad_spend + marketing_goals + marketing_campaigns.
 * Idempotente: SHOW COLUMNS + ALTER só para colunas em falta. Nunca DROP TABLE.
 * Run: npm run migrate:marketing-complete
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

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

  console.log('migrate-marketing-complete…');

  if (!(await tableExists(conn, 'ad_spend'))) {
    await conn.query(`
      CREATE TABLE ad_spend (
        id INT AUTO_INCREMENT PRIMARY KEY,
        platform ENUM('google_ads','meta','instagram','tiktok','other') NOT NULL DEFAULT 'other',
        campaign_name VARCHAR(255) NOT NULL DEFAULT '',
        campaign_id VARCHAR(100) NULL DEFAULT NULL,
        ad_set_name VARCHAR(255) NULL DEFAULT NULL,
        ad_name VARCHAR(255) NULL DEFAULT NULL,
        period_start DATE NULL DEFAULT NULL,
        period_end DATE NULL DEFAULT NULL,
        impressions INT NOT NULL DEFAULT 0,
        clicks INT NOT NULL DEFAULT 0,
        spend DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        conversions INT NOT NULL DEFAULT 0,
        conversion_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        reach INT NOT NULL DEFAULT 0,
        frequency DECIMAL(5,2) NOT NULL DEFAULT 0,
        video_views INT NOT NULL DEFAULT 0,
        notes TEXT NULL,
        import_source VARCHAR(50) NULL DEFAULT NULL,
        import_batch_id VARCHAR(100) NULL DEFAULT NULL,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        created_by INT NULL DEFAULT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        utm_campaign VARCHAR(255) NULL DEFAULT NULL,
        spend_date DATE NULL DEFAULT NULL,
        KEY idx_ad_spend_period (period_start, period_end),
        KEY idx_ad_spend_platform (platform),
        KEY idx_ad_spend_deleted (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('  ✓ created ad_spend (full)');
  } else {
    const cols = [
      ['campaign_id', '`campaign_id` VARCHAR(100) NULL DEFAULT NULL'],
      ['ad_set_name', '`ad_set_name` VARCHAR(255) NULL DEFAULT NULL'],
      ['ad_name', '`ad_name` VARCHAR(255) NULL DEFAULT NULL'],
      ['period_start', '`period_start` DATE NULL DEFAULT NULL'],
      ['period_end', '`period_end` DATE NULL DEFAULT NULL'],
      ['impressions', '`impressions` INT NOT NULL DEFAULT 0'],
      ['clicks', '`clicks` INT NOT NULL DEFAULT 0'],
      ['conversions', '`conversions` INT NOT NULL DEFAULT 0'],
      ['conversion_value', '`conversion_value` DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
      ['reach', '`reach` INT NOT NULL DEFAULT 0'],
      ['frequency', '`frequency` DECIMAL(5,2) NOT NULL DEFAULT 0'],
      ['video_views', '`video_views` INT NOT NULL DEFAULT 0'],
      ['import_source', '`import_source` VARCHAR(50) NULL DEFAULT NULL'],
      ['import_batch_id', '`import_batch_id` VARCHAR(100) NULL DEFAULT NULL'],
      ['deleted_at', '`deleted_at` TIMESTAMP NULL DEFAULT NULL'],
      ['created_by', '`created_by` INT NULL DEFAULT NULL'],
      ['updated_at', '`updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
    ];

    for (const [name, ddl] of cols) {
      if (!(await columnExists(conn, 'ad_spend', name))) {
        await addColumn(conn, 'ad_spend', ddl);
        console.log('  + ad_spend.' + name);
      }
    }

    if ((await columnExists(conn, 'ad_spend', 'notes')) && (await columnExists(conn, 'ad_spend', 'campaign_name'))) {
      try {
        await conn.query('ALTER TABLE ad_spend MODIFY COLUMN notes TEXT NULL');
        console.log('  ~ ad_spend.notes → TEXT');
      } catch (e) {
        console.warn('  (skip notes TEXT)', e.message);
      }
    }

    if (await columnExists(conn, 'ad_spend', 'spend')) {
      try {
        await conn.query('ALTER TABLE ad_spend MODIFY COLUMN spend DECIMAL(10,2) NOT NULL DEFAULT 0.00');
      } catch (_) {}
    }

    await conn.query(`
      UPDATE ad_spend SET
        period_start = COALESCE(period_start, spend_date),
        period_end = COALESCE(period_end, spend_date)
      WHERE spend_date IS NOT NULL AND (period_start IS NULL OR period_end IS NULL)
    `);

    if (await columnExists(conn, 'ad_spend', 'platform')) {
      await conn.query(`
        UPDATE ad_spend SET platform = CASE
          WHEN LOWER(platform) LIKE '%google%' THEN 'google_ads'
          WHEN LOWER(platform) IN ('instagram','ig') THEN 'instagram'
          WHEN LOWER(platform) IN ('meta','facebook','fb') THEN 'meta'
          WHEN LOWER(platform) LIKE '%tiktok%' THEN 'tiktok'
          WHEN platform IN ('google_ads','meta','instagram','tiktok','other') THEN platform
          ELSE 'other'
        END
      `);
      try {
        await conn.query(`
          ALTER TABLE ad_spend MODIFY COLUMN platform
          ENUM('google_ads','meta','instagram','tiktok','other') NOT NULL DEFAULT 'other'
        `);
        console.log('  ~ ad_spend.platform ENUM');
      } catch (e) {
        console.warn('  (platform ENUM skipped — normalize manually)', e.message);
      }
    }
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS marketing_goals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      month DATE NOT NULL,
      platform ENUM('google_ads','meta','instagram','tiktok','all') NOT NULL DEFAULT 'all',
      budget_limit DECIMAL(10,2) NULL DEFAULT NULL,
      goal_leads INT NULL DEFAULT NULL,
      goal_cpl_max DECIMAL(10,2) NULL DEFAULT NULL,
      goal_roas_min DECIMAL(5,2) NULL DEFAULT NULL,
      goal_cpa_max DECIMAL(10,2) NULL DEFAULT NULL,
      notes TEXT NULL,
      created_by INT NULL DEFAULT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_month_platform (month, platform)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ marketing_goals');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      platform ENUM('google_ads','meta','instagram','tiktok','other') NOT NULL,
      status ENUM('active','paused','ended') NOT NULL DEFAULT 'active',
      budget_monthly DECIMAL(10,2) NULL DEFAULT NULL,
      start_date DATE NULL DEFAULT NULL,
      end_date DATE NULL DEFAULT NULL,
      goal ENUM('leads','awareness','conversions','traffic') NOT NULL DEFAULT 'leads',
      notes TEXT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ marketing_campaigns');

  await conn.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
