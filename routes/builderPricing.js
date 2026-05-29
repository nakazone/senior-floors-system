/**
 * Partner pricing table — admin edit, builder read-only view.
 */
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';

const CATEGORY_LABELS = {
  supply: 'Supply',
  installation: 'Installation',
  sand_finish: 'Sand & Finish',
  custom: 'Custom',
};

function money(n) {
  return Number(n) || 0;
}

function mapServiceRow(row, overrides, builderDiscountPct) {
  const o = overrides?.[row.id];
  let partner = row.partner_price != null ? Number(row.partner_price) : null;
  if (o?.custom_price != null) partner = Number(o.custom_price);
  else if (o?.discount_pct != null && partner != null) {
    partner = partner * (1 - Number(o.discount_pct) / 100);
  } else if (builderDiscountPct && partner != null) {
    partner = partner * (1 - Number(builderDiscountPct) / 100);
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    category_label: CATEGORY_LABELS[row.category] || row.category,
    unit: row.unit,
    price_min: money(row.price_min),
    price_max: money(row.price_max),
    partner_price: partner,
    is_visible: !!row.is_visible,
    is_locked: !!row.is_locked,
    notes: row.notes,
    sort_order: row.sort_order,
  };
}

async function loadOverrides(pool, builderId) {
  if (!builderId) return {};
  const [rows] = await pool.query(
    'SELECT * FROM builder_pricing_overrides WHERE builder_id = ?',
    [builderId]
  );
  const map = {};
  for (const r of rows) map[r.service_id] = r;
  return map;
}

export async function listPricingAdmin(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [rows] = await pool.query('SELECT * FROM pricing_services ORDER BY sort_order ASC, id ASC');
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getPartnerPricingForBuilder(pool, builderId) {
  const [b] = await pool.query('SELECT discount_pct FROM builders WHERE id = ?', [builderId]);
  const discount = b[0]?.discount_pct;
  const overrides = await loadOverrides(pool, builderId);
  const [rows] = await pool.query(
    'SELECT * FROM pricing_services WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC'
  );
  return rows.map((r) => mapServiceRow(r, overrides, discount));
}

export async function listPricingBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    const builderId = req.builderAuth.builderId;
    const data = await getPartnerPricingForBuilder(pool, builderId);
    const [[metaRow]] = await pool.query(
      'SELECT MAX(updated_at) AS last_updated FROM pricing_services WHERE is_visible = 1'
    );
    const lastUpdated = metaRow?.last_updated || null;
    let validThrough = null;
    if (lastUpdated) {
      const d = new Date(lastUpdated);
      d.setMonth(d.getMonth() + 3);
      validThrough = d.toISOString().slice(0, 10);
    }
    const [b] = await pool.query(
      'SELECT company, first_name, last_name FROM builders WHERE id = ?',
      [builderId]
    );
    res.json({
      success: true,
      data,
      volume_discounts: VOLUME_DISCOUNTS,
      meta: {
        last_updated: lastUpdated,
        valid_through: validThrough,
        builder_display_name:
          b[0]?.company || [b[0]?.first_name, b[0]?.last_name].filter(Boolean).join(' ') || 'Partner',
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listPricingForBuilderId(req, res) {
  try {
    const pool = await getDBConnection();
    const builderId = parseInt(req.params.builderId, 10);
    const [b] = await pool.query('SELECT discount_pct FROM builders WHERE id = ?', [builderId]);
    const overrides = await loadOverrides(pool, builderId);
    const [rows] = await pool.query('SELECT * FROM pricing_services ORDER BY sort_order ASC, id ASC');
    res.json({
      success: true,
      data: rows.map((r) => mapServiceRow(r, overrides, b[0]?.discount_pct)),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function updatePricingService(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    await pool.execute(
      `UPDATE pricing_services SET
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        price_min = COALESCE(?, price_min),
        price_max = COALESCE(?, price_max),
        partner_price = COALESCE(?, partner_price),
        is_visible = COALESCE(?, is_visible),
        is_locked = COALESCE(?, is_locked),
        notes = COALESCE(?, notes),
        sort_order = COALESCE(?, sort_order)
       WHERE id = ?`,
      [
        b.name,
        b.category,
        b.unit,
        b.price_min,
        b.price_max,
        b.partner_price,
        b.is_visible !== undefined ? (b.is_visible ? 1 : 0) : null,
        b.is_locked !== undefined ? (b.is_locked ? 1 : 0) : null,
        b.notes,
        b.sort_order,
        id,
      ]
    );
    const [rows] = await pool.query('SELECT * FROM pricing_services WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function createPricingService(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    const [ins] = await pool.execute(
      `INSERT INTO pricing_services (name, category, unit, price_min, price_max, partner_price, is_visible, is_locked, notes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.name || 'New service',
        b.category || 'installation',
        b.unit || 'sq ft',
        b.price_min ?? 0,
        b.price_max ?? 0,
        b.partner_price ?? 0,
        b.is_visible !== false ? 1 : 0,
        b.is_locked ? 1 : 0,
        b.notes || null,
        b.sort_order ?? 99,
      ]
    );
    const [rows] = await pool.query('SELECT * FROM pricing_services WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

const VOLUME_DISCOUNTS = [
  { min_sqft: 500, max_sqft: 999, discount_pct: 5 },
  { min_sqft: 1000, max_sqft: 2499, discount_pct: 8 },
  { min_sqft: 2500, max_sqft: 4999, discount_pct: 12 },
  { min_sqft: 5000, max_sqft: null, discount_pct: 15 },
];

export function registerBuilderPricingRoutes(app) {
  app.get('/api/pricing', requireAuth, requirePermission('builders.view'), listPricingAdmin);
  app.get('/api/pricing/partner', requireBuilderAuth, listPricingBuilder);
  app.get(
    '/api/pricing/builder/:builderId',
    requireAuth,
    requirePermission('builders.view'),
    listPricingForBuilderId
  );
  app.put('/api/pricing/:id', requireAuth, requirePermission('builders.edit'), updatePricingService);
  app.post('/api/pricing', requireAuth, requirePermission('builders.edit'), createPricingService);
  app.get('/api/pricing/volume-discounts', (req, res) => {
    res.json({ success: true, data: VOLUME_DISCOUNTS });
  });
}
