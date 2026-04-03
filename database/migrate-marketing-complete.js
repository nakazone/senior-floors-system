/**
 * Completa ad_spend + marketing_goals + marketing_campaigns.
 * Idempotente: SHOW COLUMNS + ALTER só para colunas em falta. Nunca DROP TABLE.
 * Run: npm run migrate:marketing-complete
 *
 * Usa a mesma resolução de credenciais que a app (DATABASE_URL, MYSQL*, DB_*)
 * e força localhost → 127.0.0.1 para evitar ::1:3306 no macOS.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { getMysqlConnectionConfig, getMysqlEnvDiagnostics, parseDatabaseUrl } from '../config/db.js';

function isRailwayInternalHost(host) {
  return typeof host === 'string' && /\.railway\.internal$/i.test(host.trim());
}

function isLocalMysqlHost(host) {
  const h = String(host || '')
    .trim()
    .toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * Variáveis que o Railway injeta no container em execução — não confiar em RAILWAY_PROJECT_ID /
 * RAILWAY_ENVIRONMENT no .env local (copiadas do painel e dão falso "estou na Railway").
 */
function isLikelyInsideRailwayContainer() {
  return Boolean(
    process.env.RAILWAY_REPLICA_ID ||
      process.env.RAILWAY_DEPLOYMENT_ID ||
      String(process.env.RAILWAY || '').toLowerCase() === 'true'
  );
}

/**
 * Host *.railway.internal só resolve dentro da rede Railway.
 * Fora do container: obrigatório DATABASE_PUBLIC_URL (URL pública) ou railway run.
 */
function resolveMysqlConfigForMigrate() {
  let cfg = getMysqlConnectionConfig();
  if (!cfg) return { cfg: null };

  if (isRailwayInternalHost(cfg.host)) {
    const pubUrl = process.env.DATABASE_PUBLIC_URL?.trim();
    if (pubUrl) {
      const pub = parseDatabaseUrl(pubUrl);
      if (pub && pub.user && pub.database && !isRailwayInternalHost(pub.host)) {
        if (isLocalMysqlHost(pub.host)) {
          console.error(
            '[migrate] DATABASE_PUBLIC_URL aponta para localhost — isso não liga à MySQL da Railway no seu Mac.'
          );
          console.error(
            '  Railway → serviço MySQL → Connect → copie a URL "Public network" (host tipo *.proxy.rlwy.net, não localhost).'
          );
          if (!isLikelyInsideRailwayContainer()) {
            return { cfg, internalOnly: true, internalHost: cfg.host };
          }
        } else {
          console.warn(
            '[migrate] Host interno Railway; a usar DATABASE_PUBLIC_URL (ligação a partir desta máquina).'
          );
          return { cfg: { ...pub } };
        }
      }
    }
    if (!isLikelyInsideRailwayContainer()) {
      return { cfg, internalOnly: true, internalHost: cfg.host };
    }
  }
  return { cfg };
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

async function addColumn(conn, table, ddl) {
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
}

function printRailwayInternalHelp(host) {
  console.error('[migrate] Host', host || 'mysql.railway.internal', 'só existe na rede privada Railway — não resolve no seu computador (ENOTFOUND).');
  console.error('  Opções:');
  console.error('  1) Railway CLI (recomendado):');
  console.error('     cd senior-floors-system && railway run -s senior-floors-system npm run migrate:marketing-complete');
  console.error('  2) No .env local: copie do painel Railway → MySQL → Connect → "Public network" a URL para:');
  console.error('     DATABASE_PUBLIC_URL=mysql://...');
  console.error('  3) Ou defina DB_HOST / DB_USER / DB_PASS / DB_NAME com o host público (ex. *.proxy.rlwy.net), não o interno.');
}

async function main() {
  const resolved = resolveMysqlConfigForMigrate();
  if (resolved.internalOnly) {
    printRailwayInternalHelp(resolved.internalHost);
    console.error('  Diagnóstico:', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
    process.exit(1);
  }
  const cfg = resolved.cfg;
  if (!cfg) {
    console.error('[migrate] MySQL não configurado.');
    console.error('  Defina DATABASE_URL ou DB_HOST + DB_USER + DB_PASS + DB_NAME no .env');
    console.error('  Diagnóstico:', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
    console.error('  Na Railway: railway run -s senior-floors-system npm run migrate:marketing-complete');
    process.exit(1);
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      ...cfg,
      multipleStatements: true,
    });
  } catch (e) {
    if (e?.code === 'ECONNREFUSED') {
      console.error('[migrate] Ligação recusada em', `${cfg.host}:${cfg.port || 3306}`);
      if (isLocalMysqlHost(cfg.host)) {
        console.error('  Está a apontar para MySQL na sua máquina, mas nada está a escutar na porta 3306.');
        console.error('  Se a base de dados está na Railway:');
        console.error('  • Não use DB_HOST=localhost nem DATABASE_PUBLIC_URL com host localhost.');
        console.error('  • Use o hostname público do MySQL (ex. *.proxy.rlwy.net) em DATABASE_PUBLIC_URL ou DB_HOST.');
        console.error('  • Ou corra: railway run -s senior-floors-system npm run migrate:marketing-complete');
      } else {
        console.error('  • Confirme firewall / IP permitido no painel MySQL e porta', cfg.port || 3306);
        console.error('  • railway run -s senior-floors-system npm run migrate:marketing-complete');
      }
      process.exit(1);
    }
    if (e?.code === 'ENOTFOUND' && isRailwayInternalHost(cfg.host)) {
      printRailwayInternalHelp(cfg.host);
      process.exit(1);
    }
    throw e;
  }

  console.log('migrate-marketing-complete…', `(host=${cfg.host}, db=${cfg.database})`);

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
