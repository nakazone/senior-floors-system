import crypto from 'crypto';

export function newPublicToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function quoteColumns(pool) {
  const [colRows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' ORDER BY ORDINAL_POSITION`
  );
  return new Set(colRows.map((r) => r.n));
}

export async function insertQuoteSnapshot(pool, quoteId, payload, userId) {
  await pool.execute(
    `INSERT INTO quote_snapshots (quote_id, snapshot_json, created_by) VALUES (?, CAST(? AS CHAR CHARACTER SET utf8mb4), ?)`,
    [quoteId, JSON.stringify(payload), userId || null]
  );
}

export async function listSnapshots(pool, quoteId) {
  const [rows] = await pool.query(
    `SELECT id, quote_id, snapshot_json, created_by, created_at
     FROM quote_snapshots WHERE quote_id = ? ORDER BY id DESC LIMIT 50`,
    [quoteId]
  );
  return rows.map((r) => ({
    ...r,
    snapshot: safeJson(r.snapshot_json),
  }));
}

function safeJson(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return null;
  }
}

export async function replaceQuoteItems(pool, quoteId, items) {
  await pool.execute('DELETE FROM quote_items WHERE quote_id = ?', [quoteId]);
  let order = 0;
  for (const raw of items) {
    order += 1;
    const it = normalizeRow(raw, order);
    await pool.execute(
      `INSERT INTO quote_items (
        quote_id, floor_type, area_sqft, unit_price, total_price, notes, type, name, description, quantity,
        service_catalog_id, unit_type, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quoteId,
        it.floor_type,
        it.area_sqft,
        it.unit_price,
        it.total_price,
        it.notes || null,
        it.type,
        it.name || null,
        it.description || null,
        it.quantity,
        it.service_catalog_id,
        it.unit_type,
        it.sort_order,
      ]
    );
  }
}

function normalizeRow(raw, sortOrder) {
  const quantity = Number(raw.quantity) || 0;
  const rate = Number(raw.rate ?? raw.unit_price) || 0;
  const total =
    raw.total_price != null && raw.total_price !== ''
      ? Number(raw.total_price)
      : Math.round(quantity * rate * 100) / 100;
  const desc = raw.description || raw.name || '';
  return {
    floor_type: String(raw.floor_type || 'General').slice(0, 100),
    area_sqft: quantity,
    unit_price: rate,
    total_price: total,
    notes: raw.notes || null,
    type: raw.type && ['material', 'labor', 'service'].includes(raw.type) ? raw.type : 'service',
    name: raw.name ? String(raw.name).slice(0, 255) : null,
    description: desc ? String(desc) : null,
    quantity,
    service_catalog_id: raw.service_catalog_id != null ? parseInt(raw.service_catalog_id, 10) || null : null,
    unit_type: normalizeUnitType(raw.unit_type),
    sort_order: raw.sort_order != null ? parseInt(raw.sort_order, 10) : sortOrder,
  };
}

function normalizeUnitType(u) {
  const v = String(u || 'sq_ft').toLowerCase().replace(/\s/g, '_');
  const allowed = ['sq_ft', 'linear_ft', 'inches', 'fixed'];
  if (allowed.includes(v)) return v;
  if (v === 'sqft') return 'sq_ft';
  return 'sq_ft';
}

export async function listCatalog(pool, activeOnly = true) {
  const sql = activeOnly
    ? 'SELECT * FROM quote_service_catalog WHERE active = 1 ORDER BY category, name'
    : 'SELECT * FROM quote_service_catalog ORDER BY category, name';
  const [rows] = await pool.query(sql);
  return rows;
}

export async function getCatalogItem(pool, id) {
  const [rows] = await pool.query('SELECT * FROM quote_service_catalog WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function insertCatalogItem(pool, row) {
  const [r] = await pool.execute(
    `INSERT INTO quote_service_catalog (name, category, default_rate, unit_type, default_description, active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.name,
      row.category,
      row.default_rate,
      normalizeUnitType(row.unit_type),
      row.default_description || null,
      row.active !== false ? 1 : 0,
    ]
  );
  return r.insertId;
}

export async function updateCatalogItem(pool, id, row) {
  await pool.execute(
    `UPDATE quote_service_catalog SET name = ?, category = ?, default_rate = ?, unit_type = ?,
     default_description = ?, active = ? WHERE id = ?`,
    [
      row.name,
      row.category,
      row.default_rate,
      normalizeUnitType(row.unit_type),
      row.default_description || null,
      row.active !== false ? 1 : 0,
      id,
    ]
  );
}

export async function deleteCatalogItem(pool, id) {
  await pool.execute('UPDATE quote_service_catalog SET active = 0 WHERE id = ?', [id]);
}

export async function listTemplates(pool) {
  const [rows] = await pool.query(
    'SELECT id, name, service_type, created_at, updated_at FROM quote_templates ORDER BY name'
  );
  return rows;
}

export async function getTemplateWithItems(pool, id) {
  const [tpl] = await pool.query('SELECT * FROM quote_templates WHERE id = ?', [id]);
  if (!tpl.length) return null;
  const [items] = await pool.query(
    'SELECT * FROM quote_template_items WHERE template_id = ? ORDER BY sort_order, id',
    [id]
  );
  return { ...tpl[0], items };
}

export async function insertTemplate(pool, { name, service_type, created_by, items }) {
  const [res] = await pool.execute(
    'INSERT INTO quote_templates (name, service_type, created_by) VALUES (?, ?, ?)',
    [name, service_type || null, created_by || null]
  );
  const tid = res.insertId;
  let o = 0;
  for (const raw of items || []) {
    o += 1;
    const q = Number(raw.quantity) || 1;
    const rate = Number(raw.rate ?? raw.default_rate) || 0;
    await pool.execute(
      `INSERT INTO quote_template_items (
        template_id, service_catalog_id, description, unit_type, quantity, rate, notes, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tid,
        raw.service_catalog_id != null ? parseInt(raw.service_catalog_id, 10) || null : null,
        raw.description || '',
        normalizeUnitType(raw.unit_type),
        q,
        rate,
        raw.notes || null,
        raw.sort_order != null ? raw.sort_order : o,
      ]
    );
  }
  return tid;
}

export async function deleteTemplate(pool, id) {
  await pool.execute('DELETE FROM quote_template_items WHERE template_id = ?', [id]);
  await pool.execute('DELETE FROM quote_templates WHERE id = ?', [id]);
}
