/** Builder ? project linking (projects.builder_id = customers.id, with fallbacks). */

async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0]?.c) > 0;
}

export async function getProjectBuilderLinkMeta(pool) {
  const [hasBuilderId, hasClientType, hasCustomerId, hasPartnerBuilderId, hasDeletedAt, hasBuilderProjects] =
    await Promise.all([
      columnExists(pool, 'projects', 'builder_id'),
      columnExists(pool, 'projects', 'client_type'),
      columnExists(pool, 'projects', 'customer_id'),
      columnExists(pool, 'projects', 'partner_builder_id'),
      columnExists(pool, 'projects', 'deleted_at'),
      tableExists(pool, 'builder_projects'),
    ]);
  return {
    hasBuilderId,
    hasClientType,
    hasCustomerId,
    hasPartnerBuilderId,
    hasDeletedAt,
    hasBuilderProjects,
  };
}

/** Correlated match: project row ? builders alias (e.g. p, b). */
export function buildProjectBuilderCorrelatedMatch(projectAlias, builderAlias, meta) {
  const parts = [];
  if (meta.hasBuilderId) {
    parts.push(`${projectAlias}.builder_id = ${builderAlias}.customer_id`);
  }
  if (meta.hasCustomerId && meta.hasClientType) {
    parts.push(
      `(${projectAlias}.customer_id = ${builderAlias}.customer_id AND ${projectAlias}.client_type = 'builder')`
    );
  }
  if (meta.hasPartnerBuilderId) {
    parts.push(`${projectAlias}.partner_builder_id = ${builderAlias}.id`);
  }
  if (meta.hasBuilderProjects) {
    parts.push(
      `EXISTS (SELECT 1 FROM builder_projects bp WHERE bp.project_id = ${projectAlias}.id AND bp.builder_id = ${builderAlias}.id)`
    );
  }
  return parts.length ? `(${parts.join(' OR ')})` : '0=1';
}

/** Parameterized match for a single builder (portal APIs). */
export function buildProjectBuilderMatch(projectAlias, builderId, customerId, meta) {
  const parts = [];
  const params = [];
  if (meta.hasBuilderId && customerId != null) {
    parts.push(`${projectAlias}.builder_id = ?`);
    params.push(customerId);
  }
  if (meta.hasCustomerId && meta.hasClientType && customerId != null) {
    parts.push(`(${projectAlias}.customer_id = ? AND ${projectAlias}.client_type = 'builder')`);
    params.push(customerId);
  }
  if (meta.hasPartnerBuilderId && builderId != null) {
    parts.push(`${projectAlias}.partner_builder_id = ?`);
    params.push(builderId);
  }
  if (meta.hasBuilderProjects && builderId != null) {
    parts.push(
      `EXISTS (SELECT 1 FROM builder_projects bp WHERE bp.project_id = ${projectAlias}.id AND bp.builder_id = ?)`
    );
    params.push(builderId);
  }
  return {
    sql: parts.length ? `(${parts.join(' OR ')})` : '0=1',
    params,
  };
}

export function projectNotDeletedClause(projectAlias, meta) {
  if (!meta.hasDeletedAt) return '';
  return ` AND (${projectAlias}.deleted_at IS NULL OR ${projectAlias}.deleted_at = '0000-00-00 00:00:00')`;
}

export async function getBuilderCustomerId(pool, builderId) {
  const [rows] = await pool.query('SELECT customer_id FROM builders WHERE id = ? LIMIT 1', [builderId]);
  const cid = rows[0]?.customer_id;
  return cid != null ? Number(cid) : null;
}

export async function assertBuilderOwnsProject(pool, builderId, projectId) {
  const customerId = await getBuilderCustomerId(pool, builderId);
  const meta = await getProjectBuilderLinkMeta(pool);
  const match = buildProjectBuilderMatch('p', builderId, customerId, meta);
  const [rows] = await pool.query(
    `SELECT p.* FROM projects p
     WHERE p.id = ? AND ${match.sql}${projectNotDeletedClause('p', meta)}`,
    [projectId, ...match.params]
  );
  return rows[0] || null;
}

export function photoPublicUrl(row) {
  const fu = row.file_url != null ? String(row.file_url).trim() : '';
  if (fu) return fu.startsWith('/') ? fu : `/${fu}`;
  const fp = String(row.file_path || '').replace(/^\//, '');
  return fp ? `/uploads/${fp}` : '';
}
