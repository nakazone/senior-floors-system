/**
 * API financeira completa: P&L empresa, previsão, vendors, custos operacionais, recebimentos.
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { getDBConnection } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getCompanyPL,
  generateWeeklyForecast,
  updateVendorTotalSpent,
  importMarketingCosts,
} from '../lib/financialEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads', 'receipts', 'operational');

const receiptStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.bin';
    cb(null, `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
  },
});
const uploadReceipt = multer({ storage: receiptStorage, limits: { fileSize: 15 * 1024 * 1024 } });

function periodBounds(req) {
  const { period = 'month', start, end } = req.query;
  let periodStart;
  let periodEnd;
  if (start && end) {
    periodStart = String(start).slice(0, 10);
    periodEnd = String(end).slice(0, 10);
  } else {
    const now = new Date();
    if (period === 'month') {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    } else if (period === 'quarter') {
      const q = Math.floor(now.getMonth() / 3);
      periodStart = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0, 10);
      periodEnd = new Date(now.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10);
    } else {
      periodStart = `${now.getFullYear()}-01-01`;
      periodEnd = `${now.getFullYear()}-12-31`;
    }
  }
  return { periodStart, periodEnd };
}

/** Rotas em /api/financial (além de /api/financial/dashboard já registado no index) */
export const financialPlRouter = Router();
financialPlRouter.use(requireAuth);

financialPlRouter.get('/pl', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const { periodStart, periodEnd } = periodBounds(req);
    const pl = await getCompanyPL(pool, periodStart, periodEnd);
    res.json({ success: true, data: pl, period: { start: periodStart, end: periodEnd } });
  } catch (e) {
    console.error('GET /financial/pl', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

financialPlRouter.get('/weekly-forecast', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const date = req.query.week ? new Date(`${req.query.week}T12:00:00`) : new Date();
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date);
    monday.setDate(diff);
    const mondayStr = monday.toISOString().slice(0, 10);
    const forecast = await generateWeeklyForecast(pool, mondayStr);
    res.json({ success: true, data: forecast });
  } catch (e) {
    console.error('GET /financial/weekly-forecast', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

financialPlRouter.get('/cash-flow', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
    const results = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = d.toISOString().slice(0, 10);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const pl = await getCompanyPL(pool, start, end);
      results.push({
        month: d.toISOString().slice(0, 7),
        label,
        revenue: pl.revenue,
        received: pl.received,
        costs: pl.costs.total,
        net_profit: pl.net_profit,
        net_margin: pl.net_margin_pct,
      });
    }
    res.json({ success: true, data: results });
  } catch (e) {
    console.error('GET /financial/cash-flow', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

financialPlRouter.post('/import-marketing', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const { period_start, period_end } = req.body || {};
    if (!period_start || !period_end) {
      return res.status(400).json({ success: false, error: 'period_start e period_end obrigatórios' });
    }
    const result = await importMarketingCosts(pool, period_start, period_end);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('POST /financial/import-marketing', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** /api/vendors */
export const vendorsRouter = Router();
vendorsRouter.use(requireAuth);

vendorsRouter.get('/', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const q = req.query.search ? `%${String(req.query.search).trim()}%` : null;
    let sql = 'SELECT * FROM vendors WHERE 1=1';
    const params = [];
    if (req.query.active !== '0') {
      sql += ' AND is_active = 1';
    }
    if (q) {
      sql += ' AND (name LIKE ? OR contact_name LIKE ? OR contact_email LIKE ?)';
      params.push(q, q, q);
    }
    sql += ' ORDER BY name ASC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('GET /vendors', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

vendorsRouter.post('/', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const b = req.body || {};
    const uid = req.session?.userId || null;
    const [ins] = await pool.execute(
      `INSERT INTO vendors (name, category, contact_name, contact_email, contact_phone, website, address,
        payment_terms, tax_id, notes, rating, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        String(b.name || '').slice(0, 255),
        b.category || 'other',
        b.contact_name || null,
        b.contact_email || null,
        b.contact_phone || null,
        b.website || null,
        b.address || null,
        b.payment_terms || null,
        b.tax_id || null,
        b.notes || null,
        b.rating != null ? parseInt(b.rating, 10) : null,
        uid,
      ]
    );
    const [[row]] = await pool.query('SELECT * FROM vendors WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error('POST /vendors', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

vendorsRouter.get('/:id/history', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const [expenses] = await pool.query(
      `SELECT 'expense' AS type, description, total_amount AS amount, expense_date AS date, status
       FROM expenses WHERE vendor_id = ? ORDER BY expense_date DESC LIMIT 50`,
      [id]
    );
    const [opcosts] = await pool.query(
      `SELECT 'operational' AS type, description, total_amount AS amount, expense_date AS date, status
       FROM operational_costs WHERE vendor_id = ? AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')
       ORDER BY expense_date DESC LIMIT 50`,
      [id]
    );
    const all = [...expenses, ...opcosts].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, data: all });
  } catch (e) {
    console.error('GET /vendors/:id/history', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

vendorsRouter.get('/:id', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const [[row]] = await pool.query('SELECT * FROM vendors WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: row });
  } catch (e) {
    console.error('GET /vendors/:id', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

vendorsRouter.put('/:id', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const [[ex]] = await pool.query('SELECT * FROM vendors WHERE id = ?', [id]);
    if (!ex) return res.status(404).json({ success: false, error: 'Not found' });
    const name = b.name !== undefined ? String(b.name).slice(0, 255) : ex.name;
    const category = b.category !== undefined ? b.category : ex.category;
    const isActive = b.is_active !== undefined ? (b.is_active ? 1 : 0) : ex.is_active;
    await pool.execute(
      `UPDATE vendors SET
        name = ?, category = ?, contact_name = ?, contact_email = ?, contact_phone = ?, website = ?, address = ?,
        payment_terms = ?, tax_id = ?, notes = ?, rating = ?, is_active = ?
       WHERE id = ?`,
      [
        name,
        category,
        b.contact_name !== undefined ? b.contact_name : ex.contact_name,
        b.contact_email !== undefined ? b.contact_email : ex.contact_email,
        b.contact_phone !== undefined ? b.contact_phone : ex.contact_phone,
        b.website !== undefined ? b.website : ex.website,
        b.address !== undefined ? b.address : ex.address,
        b.payment_terms !== undefined ? b.payment_terms : ex.payment_terms,
        b.tax_id !== undefined ? b.tax_id : ex.tax_id,
        b.notes !== undefined ? b.notes : ex.notes,
        b.rating !== undefined ? b.rating : ex.rating,
        isActive,
        id,
      ]
    );
    await updateVendorTotalSpent(pool, id);
    const [[row]] = await pool.query('SELECT * FROM vendors WHERE id = ?', [id]);
    res.json({ success: true, data: row });
  } catch (e) {
    console.error('PUT /vendors/:id', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

vendorsRouter.delete('/:id', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    await pool.execute('UPDATE vendors SET is_active = 0, updated_at = NOW() WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /vendors/:id', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** /api/operational-costs */
export const operationalCostsRouter = Router();
operationalCostsRouter.use(requireAuth);

operationalCostsRouter.get('/recurring', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [rows] = await pool.query(
      `SELECT oc.*, v.name AS vendor_name
       FROM operational_costs oc
       LEFT JOIN vendors v ON oc.vendor_id = v.id
       WHERE oc.is_recurring = 1 AND (oc.deleted_at IS NULL OR oc.deleted_at = '0000-00-00 00:00:00')
       ORDER BY oc.expense_date DESC`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('GET /operational-costs/recurring', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

operationalCostsRouter.get('/', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const start = req.query.start_date || null;
    const end = req.query.end_date || null;
    const cat = req.query.category || null;
    let sql = `SELECT oc.*, v.name AS vendor_name FROM operational_costs oc
      LEFT JOIN vendors v ON oc.vendor_id = v.id
      WHERE (oc.deleted_at IS NULL OR oc.deleted_at = '0000-00-00 00:00:00')`;
    const params = [];
    if (start) {
      sql += ' AND oc.expense_date >= ?';
      params.push(start);
    }
    if (end) {
      sql += ' AND oc.expense_date <= ?';
      params.push(end);
    }
    if (cat) {
      sql += ' AND oc.category = ?';
      params.push(cat);
    }
    sql += ' ORDER BY oc.expense_date DESC, oc.id DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('GET /operational-costs', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

operationalCostsRouter.get('/:id', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const [[row]] = await pool.query(
      `SELECT oc.*, v.name AS vendor_name FROM operational_costs oc
       LEFT JOIN vendors v ON oc.vendor_id = v.id WHERE oc.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: row });
  } catch (e) {
    console.error('GET /operational-costs/:id', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

operationalCostsRouter.post('/', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const b = req.body || {};
    const uid = req.session?.userId || null;
    const amount = parseFloat(b.amount) || 0;
    const tax = parseFloat(b.tax_amount) || 0;
    const total = b.total_amount != null ? parseFloat(b.total_amount) : amount + tax;
    const [ins] = await pool.execute(
      `INSERT INTO operational_costs (
        category, subcategory, vendor_id, description, amount, tax_amount, total_amount,
        expense_date, payment_method, status, is_recurring, recurrence_type, recurrence_day,
        recurrence_end_date, notes, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.category || 'other',
        b.subcategory || null,
        b.vendor_id || null,
        String(b.description || 'Item').slice(0, 255),
        amount,
        tax,
        total,
        b.expense_date || new Date().toISOString().slice(0, 10),
        b.payment_method || 'credit_card',
        b.status || 'pending',
        b.is_recurring ? 1 : 0,
        b.recurrence_type || null,
        b.recurrence_day != null ? parseInt(b.recurrence_day, 10) : null,
        b.recurrence_end_date || null,
        b.notes || null,
        uid,
      ]
    );
    if (b.vendor_id) await updateVendorTotalSpent(pool, b.vendor_id);
    const [[row]] = await pool.query('SELECT * FROM operational_costs WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error('POST /operational-costs', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

operationalCostsRouter.post('/:id/receipt', uploadReceipt.single('file'), async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    if (!req.file) return res.status(400).json({ success: false, error: 'Arquivo obrigatório' });
    const id = parseInt(req.params.id, 10);
    const rel = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
    const url = `/uploads/${rel}`;
    await pool.query('UPDATE operational_costs SET receipt_path = ?, receipt_url = ? WHERE id = ?', [
      rel,
      url,
      id,
    ]);
    res.json({ success: true, receipt_url: url });
  } catch (e) {
    console.error('POST /operational-costs/:id/receipt', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

operationalCostsRouter.put('/:id', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const [[ex]] = await pool.query('SELECT * FROM operational_costs WHERE id = ?', [id]);
    if (!ex) return res.status(404).json({ success: false, error: 'Not found' });
    const amount = b.amount != null ? parseFloat(b.amount) : parseFloat(ex.amount);
    const tax = b.tax_amount != null ? parseFloat(b.tax_amount) : parseFloat(ex.tax_amount);
    const total = b.total_amount != null ? parseFloat(b.total_amount) : amount + tax;
    await pool.execute(
      `UPDATE operational_costs SET
        category = COALESCE(?, category),
        subcategory = ?,
        vendor_id = ?,
        description = COALESCE(?, description),
        amount = ?,
        tax_amount = ?,
        total_amount = ?,
        expense_date = COALESCE(?, expense_date),
        payment_method = COALESCE(?, payment_method),
        status = COALESCE(?, status),
        is_recurring = ?,
        recurrence_type = ?,
        recurrence_day = ?,
        recurrence_end_date = ?,
        notes = ?
       WHERE id = ?`,
      [
        b.category || null,
        b.subcategory !== undefined ? b.subcategory : ex.subcategory,
        b.vendor_id !== undefined ? b.vendor_id : ex.vendor_id,
        b.description != null ? String(b.description).slice(0, 255) : null,
        amount,
        tax,
        total,
        b.expense_date || null,
        b.payment_method || null,
        b.status || null,
        b.is_recurring !== undefined ? (b.is_recurring ? 1 : 0) : ex.is_recurring,
        b.recurrence_type !== undefined ? b.recurrence_type : ex.recurrence_type,
        b.recurrence_day !== undefined ? b.recurrence_day : ex.recurrence_day,
        b.recurrence_end_date !== undefined ? b.recurrence_end_date : ex.recurrence_end_date,
        b.notes !== undefined ? b.notes : ex.notes,
        id,
      ]
    );
    const vid = b.vendor_id !== undefined ? b.vendor_id : ex.vendor_id;
    if (vid) await updateVendorTotalSpent(pool, vid);
    const [[row]] = await pool.query('SELECT * FROM operational_costs WHERE id = ?', [id]);
    res.json({ success: true, data: row });
  } catch (e) {
    console.error('PUT /operational-costs/:id', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

operationalCostsRouter.delete('/:id', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    await pool.execute('UPDATE operational_costs SET deleted_at = NOW() WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /operational-costs/:id', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** /api/payment-receipts */
export const paymentReceiptsRouter = Router();
paymentReceiptsRouter.use(requireAuth);

paymentReceiptsRouter.get('/pending-summary', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [rows] = await pool.query(
      `SELECT
        p.id,
        COALESCE(p.project_number, CONCAT('PRJ-', p.id)) AS project_label,
        COALESCE(p.contract_value, 0) AS contract_value,
        COALESCE((SELECT SUM(pr.amount) FROM payment_receipts pr WHERE pr.project_id = p.id), 0) AS received_total
      FROM projects p
      WHERE COALESCE(p.contract_value, 0) > COALESCE((SELECT SUM(pr.amount) FROM payment_receipts pr WHERE pr.project_id = p.id), 0)
      ORDER BY (COALESCE(p.contract_value, 0) - COALESCE((SELECT SUM(pr.amount) FROM payment_receipts pr WHERE pr.project_id = p.id), 0)) DESC
      LIMIT 50`
    );
    const data = rows.map((r) => ({
      ...r,
      pending: (parseFloat(r.contract_value) || 0) - (parseFloat(r.received_total) || 0),
    }));
    res.json({ success: true, data });
  } catch (e) {
    console.error('GET /payment-receipts/pending-summary', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

paymentReceiptsRouter.get('/', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
    let sql = `SELECT pr.*, COALESCE(p.project_number, CONCAT('PRJ-', p.id)) AS project_label
      FROM payment_receipts pr JOIN projects p ON pr.project_id = p.id WHERE 1=1`;
    const params = [];
    if (projectId) {
      sql += ' AND pr.project_id = ?';
      params.push(projectId);
    }
    sql += ' ORDER BY pr.payment_date DESC, pr.id DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('GET /payment-receipts', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

paymentReceiptsRouter.post('/', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const b = req.body || {};
    const uid = req.session?.userId || null;
    const [ins] = await pool.execute(
      `INSERT INTO payment_receipts (
        project_id, payment_type, amount, payment_date, payment_method, reference_number, notes, receipt_path
      ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        parseInt(b.project_id, 10),
        b.payment_type || 'other',
        parseFloat(b.amount) || 0,
        b.payment_date || new Date().toISOString().slice(0, 10),
        b.payment_method || 'check',
        b.reference_number || null,
        b.notes || null,
        b.receipt_path || null,
      ]
    );
    const [[row]] = await pool.query('SELECT * FROM payment_receipts WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error('POST /payment-receipts', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

paymentReceiptsRouter.put('/:id', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    await pool.execute(
      `UPDATE payment_receipts SET
        payment_type = COALESCE(?, payment_type),
        amount = COALESCE(?, amount),
        payment_date = COALESCE(?, payment_date),
        payment_method = COALESCE(?, payment_method),
        reference_number = ?,
        notes = ?
       WHERE id = ?`,
      [
        b.payment_type || null,
        b.amount != null ? parseFloat(b.amount) : null,
        b.payment_date || null,
        b.payment_method || null,
        b.reference_number !== undefined ? b.reference_number : null,
        b.notes !== undefined ? b.notes : null,
        id,
      ]
    );
    const [[row]] = await pool.query('SELECT * FROM payment_receipts WHERE id = ?', [id]);
    res.json({ success: true, data: row });
  } catch (e) {
    console.error('PUT /payment-receipts/:id', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

paymentReceiptsRouter.delete('/:id', async (req, res) => {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = parseInt(req.params.id, 10);
    await pool.execute('DELETE FROM payment_receipts WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /payment-receipts/:id', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
