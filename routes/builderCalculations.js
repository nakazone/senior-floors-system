/**
 * Saved calculator runs for builder portal.
 */
import crypto from 'crypto';
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { getPartnerPricingForBuilder } from './builderPricing.js';
import { calculateLine, sumCalculationLines } from '../lib/builderPricingCalc.js';

function parseItems(val) {
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

export async function calculateMulti(req, res) {
  try {
    const pool = await getDBConnection();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'items array required' });
    }
    const services = await getPartnerPricingForBuilder(pool, req.builderAuth.builderId);
    const lines = [];
    for (const it of items) {
      const serviceId = parseInt(it.service_id, 10);
      const area = parseInt(it.area_sqft, 10);
      const svc = services.find((s) => s.id === serviceId);
      if (!svc || svc.is_locked || !area) continue;
      lines.push(calculateLine(svc, area));
    }
    if (!lines.length) {
      return res.status(400).json({ success: false, error: 'No valid service lines' });
    }
    res.json({
      success: true,
      data: { lines, totals: sumCalculationLines(lines) },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listCalculations(req, res) {
  try {
    const pool = await getDBConnection();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const [rows] = await pool.query(
      `SELECT id, label, items_json, total_low, total_high, area_sqft_total, share_token, created_at
       FROM builder_calculations WHERE builder_id = ? ORDER BY created_at DESC LIMIT ?`,
      [req.builderAuth.builderId, limit]
    );
    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        items: parseItems(r.items_json),
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function saveCalculation(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'items required' });
    }
    const totals = b.totals || sumCalculationLines(items);
    const shareToken = crypto.randomBytes(16).toString('hex');
    const [ins] = await pool.execute(
      `INSERT INTO builder_calculations (builder_id, label, items_json, total_low, total_high, area_sqft_total, share_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.builderAuth.builderId,
        b.label ? String(b.label).slice(0, 255) : null,
        JSON.stringify(items),
        totals.estimate_low_discounted || 0,
        totals.estimate_high_discounted || 0,
        totals.area_sqft || null,
        shareToken,
      ]
    );
    res.status(201).json({
      success: true,
      data: {
        id: ins.insertId,
        share_token: shareToken,
        share_path: `/builder-calculator-share.html?token=${shareToken}`,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getSharedCalculation(req, res) {
  try {
    const pool = await getDBConnection();
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'token required' });
    const [rows] = await pool.query(
      `SELECT c.id, c.label, c.items_json, c.total_low, c.total_high, c.area_sqft_total, c.created_at,
              b.company, b.first_name, b.last_name
       FROM builder_calculations c
       JOIN builders b ON b.id = c.builder_id
       WHERE c.share_token = ? LIMIT 1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const r = rows[0];
    res.json({
      success: true,
      data: {
        label: r.label,
        items: parseItems(r.items_json),
        total_low: r.total_low,
        total_high: r.total_high,
        area_sqft_total: r.area_sqft_total,
        created_at: r.created_at,
        builder_name: r.company || [r.first_name, r.last_name].filter(Boolean).join(' '),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderCalculationRoutes(app) {
  app.post('/api/pricing/calculate-multi', requireBuilderAuth, calculateMulti);
  app.get('/api/builder-calculations', requireBuilderAuth, listCalculations);
  app.post('/api/builder-calculations', requireBuilderAuth, saveCalculation);
  app.get('/api/builder-calculations/share/:token', getSharedCalculation);
}
