import { insertChecklistTemplate } from '../../database/seed-project-checklist-templates.js';

export function money(n) {
  const x = parseFloat(n);
  return Number.isFinite(x) ? x : 0;
}

export function moneyRound(n, d = 2) {
  const x = money(n);
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

/** Colunas atuais da tabela `projects` (schema novo ou legado). */
export async function getProjectsTableColumnSet(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
  );
  return new Set((rows || []).map((r) => r.n));
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 */
export async function recalcProjectActualCosts(pool, projectId) {
  const id = parseInt(String(projectId), 10);
  if (!Number.isFinite(id) || id <= 0) return;
  const [[h]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_costs' AND COLUMN_NAME = 'is_projected'`
  );
  const projFilter = Number(h?.c) > 0 ? 'AND IFNULL(c.is_projected,0)=0' : '';
  await pool.execute(
    `UPDATE projects p SET
      labor_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'labor' ${projFilter}), 0),
      material_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'material' ${projFilter}), 0),
      additional_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'additional' ${projFilter}), 0)
     WHERE p.id = ?`,
    [id]
  );
}

/**
 * Gera PRJ-YYYY-NNN se existir coluna `project_number`; caso contrário devolve `null` (schemas legados).
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<string|null>}
 */
export async function nextProjectNumber(pool) {
  const cols = await getProjectsTableColumnSet(pool);
  if (!cols.has('project_number')) return null;
  const year = new Date().getFullYear();
  const prefix = `PRJ-${year}-`;
  const [rows] = await pool.query(
    `SELECT project_number FROM projects
     WHERE project_number IS NOT NULL AND project_number LIKE ?
     ORDER BY id DESC LIMIT 50`,
    [`${prefix}%`]
  );
  let max = 0;
  const re = new RegExp(`^PRJ-${year}-(\\d+)$`);
  for (const r of rows) {
    const m = String(r.project_number || '').match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 */
export async function seedChecklistIfEmpty(pool, projectId) {
  const [[{ c }]] = await pool.query(
    'SELECT COUNT(*) AS c FROM project_checklist WHERE project_id = ?',
    [projectId]
  );
  if (Number(c) > 0) return;
  await insertChecklistTemplate(pool, projectId);
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} projectId
 */
export async function refreshChecklistCompletedFlag(pool, projectId) {
  const [[agg]] = await pool.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN checked = 1 THEN 1 ELSE 0 END), 0) AS done
     FROM project_checklist WHERE project_id = ?`,
    [projectId]
  );
  const total = Number(agg.total) || 0;
  const done = Number(agg.done) || 0;
  if (total > 0 && done === total) {
    await pool.execute(
      `UPDATE projects SET checklist_completed = 1,
        checklist_completed_at = COALESCE(checklist_completed_at, NOW())
       WHERE id = ?`,
      [projectId]
    );
  } else {
    await pool.execute(
      'UPDATE projects SET checklist_completed = 0, checklist_completed_at = NULL WHERE id = ?',
      [projectId]
    );
  }
}

/** Normaliza status legado (ex.: enum Hostinger `quoted`) para UI nova. */
function normalizeProjectStatus(s) {
  const v = String(s || '');
  if (v === 'quoted') return 'scheduled';
  return v;
}

export function mapListProjectRow(p) {
  const contract = money(p.contract_value ?? p.estimated_cost);
  const labor = money(p.labor_cost_actual);
  const mat = money(p.material_cost_actual);
  const add = money(p.additional_cost_actual);
  let totalCost = labor + mat + add;
  if (totalCost === 0 && p.actual_cost != null && String(p.actual_cost).trim() !== '') {
    totalCost = money(p.actual_cost);
  }
  const gross = contract - totalCost;
  const marginPct = contract > 0 ? moneyRound((gross / contract) * 100, 1) : 0;
  const startDate = p.start_date ?? p.estimated_start_date ?? null;
  const endEst = p.end_date_estimated ?? p.estimated_end_date ?? null;
  const completion =
    p.completion_percentage != null && p.completion_percentage !== ''
      ? parseInt(String(p.completion_percentage), 10)
      : p.status === 'completed'
        ? 100
        : 0;
  return {
    ...p,
    status: normalizeProjectStatus(p.status),
    start_date: startDate,
    end_date_estimated: endEst,
    checklist_completed: !!(p.checklist_completed === 1 || p.checklist_completed === true),
    contract_value: moneyRound(contract, 2),
    supply_value: moneyRound(money(p.supply_value), 2),
    installation_value: moneyRound(money(p.installation_value), 2),
    sand_finish_value: moneyRound(money(p.sand_finish_value), 2),
    labor_cost_actual: moneyRound(labor, 2),
    material_cost_actual: moneyRound(mat, 2),
    additional_cost_actual: moneyRound(add, 2),
    total_cost_actual: moneyRound(totalCost, 2),
    gross_profit: moneyRound(gross, 2),
    margin_pct: marginPct,
    total_sqft: p.total_sqft != null ? moneyRound(p.total_sqft, 2) : null,
    completion_percentage: Number.isFinite(completion) ? completion : 0,
    photos_count: parseInt(String(p.photos_count ?? 0), 10) || 0,
    checklist_total: parseInt(String(p.checklist_total ?? 0), 10) || 0,
    checklist_done: parseInt(String(p.checklist_done ?? 0), 10) || 0,
  };
}
