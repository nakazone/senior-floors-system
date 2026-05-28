/**
 * Builder Partner Portal  admin CRUD + builder-scoped reads.
 */
import bcrypt from 'bcryptjs';
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { randomTempPassword } from '../lib/builderJwt.js';

function parseJsonField(val, fallback = []) {
  if (val == null) return fallback;
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function builderDisplayName(b) {
  return [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || b.company || b.email;
}

async function syncCustomerForBuilder(pool, body, builderId, existingCustomerId) {
  const company = String(body.company || '').trim() || builderDisplayName(body);
  const responsible = builderDisplayName(body);
  let customerId = existingCustomerId;

  if (customerId) {
    await pool.execute(
      `UPDATE customers SET name = ?, email = ?, phone = ?, responsible_name = ?, customer_type = 'builder', status = 'active'
       WHERE id = ?`,
      [company, body.email || null, body.phone || null, responsible, customerId]
    );
  } else {
    const [ins] = await pool.execute(
      `INSERT INTO customers (name, email, phone, responsible_name, customer_type, status, notes)
       VALUES (?, ?, ?, ?, 'builder', 'active', ?)`,
      [
        company,
        body.email || null,
        body.phone || null,
        responsible,
        `Builder portal partner #${builderId}`,
      ]
    );
    customerId = ins.insertId;
    await pool.execute('UPDATE builders SET customer_id = ? WHERE id = ?', [customerId, builderId]);
  }
  return customerId;
}

export async function listBuilders(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const status = req.query.status || null;
    const type = req.query.type || null;
    const search = req.query.search || null;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    let where = '1=1';
    const params = [];
    if (status) {
      where += ' AND b.status = ?';
      params.push(status);
    }
    if (type) {
      where += ' AND b.type = ?';
      params.push(type);
    }
    if (search) {
      const t = `%${search}%`;
      where += ' AND (b.first_name LIKE ? OR b.last_name LIKE ? OR b.email LIKE ? OR b.company LIKE ?)';
      params.push(t, t, t, t);
    }

    const [rows] = await pool.query(
      `SELECT b.*,
        (SELECT COUNT(*) FROM projects p WHERE p.builder_id = b.customer_id AND (p.deleted_at IS NULL OR p.deleted_at = '0000-00-00 00:00:00')) AS project_count
       FROM builders b
       WHERE ${where}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM builders b WHERE ${where}`,
      params
    );

    const [[stats]] = await pool.query(`
      SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
      FROM builders`);

    const [[projStats]] = await pool.query(`
      SELECT COUNT(*) AS open_projects
      FROM projects p
      INNER JOIN builders b ON p.builder_id = b.customer_id
      WHERE p.status NOT IN ('completed','cancelled')
        AND (p.deleted_at IS NULL)`);

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        regions: parseJsonField(r.regions),
        full_name: builderDisplayName(r),
      })),
      total,
      stats: {
        active: Number(stats?.active_count) || 0,
        pending: Number(stats?.pending_count) || 0,
        open_projects: Number(projStats?.open_projects) || 0,
      },
    });
  } catch (e) {
    console.error('listBuilders:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT * FROM builders WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Builder not found' });
    const b = rows[0];
    b.regions = parseJsonField(b.regions);
    delete b.portal_password_hash;

    const [projects] = await pool.query(
      `SELECT p.id, p.name, p.address, p.status, p.contract_value, p.start_date, p.end_date_estimated,
              p.completion_percentage, p.project_number
       FROM projects p
       WHERE p.builder_id = ? AND (p.deleted_at IS NULL)
       ORDER BY p.updated_at DESC`,
      [b.customer_id]
    );

    const [docs] = await pool.query(
      'SELECT * FROM builder_documents WHERE builder_id = ? ORDER BY created_at DESC',
      [id]
    );

    const [messages] = await pool.query(
      `SELECT * FROM builder_messages WHERE builder_id = ? AND is_internal_note = 0
       ORDER BY created_at DESC LIMIT 50`,
      [id]
    );

    const [accessLog] = await pool.query(
      'SELECT * FROM builder_access_log WHERE builder_id = ? ORDER BY created_at DESC LIMIT 20',
      [id]
    );

    const [overrides] = await pool.query(
      `SELECT o.*, s.name AS service_name FROM builder_pricing_overrides o
       LEFT JOIN pricing_services s ON s.id = o.service_id WHERE o.builder_id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: {
        builder: b,
        projects,
        documents: docs,
        messages,
        access_log: accessLog,
        pricing_overrides: overrides,
      },
    });
  } catch (e) {
    console.error('getBuilder:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function createBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    const body = req.body || {};
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!email || !body.first_name || !body.last_name) {
      return res.status(400).json({ success: false, error: 'First name, last name and email required' });
    }

    const [dup] = await pool.query('SELECT id FROM builders WHERE LOWER(email) = ?', [email]);
    if (dup.length) return res.status(409).json({ success: false, error: 'Email already registered' });

    const regions = body.regions ? JSON.stringify(body.regions) : null;
    const portalAccess = body.portal_access ? 1 : 0;
    let passwordHash = null;
    let tempPassword = null;
    if (portalAccess) {
      tempPassword = body.temp_password || randomTempPassword();
      passwordHash = await bcrypt.hash(tempPassword, 10);
    }

    const [ins] = await pool.execute(
      `INSERT INTO builders (
        first_name, last_name, email, phone, company, website, type, status,
        regions, avg_ticket, annual_projects, source, referred_by, internal_note,
        portal_access, portal_password_hash, discount_pct
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.first_name,
        body.last_name,
        email,
        body.phone || null,
        body.company || null,
        body.website || null,
        body.type || 'contractor',
        body.status || 'pending',
        regions,
        body.avg_ticket || null,
        body.annual_projects != null ? Number(body.annual_projects) : null,
        body.source || null,
        body.referred_by || null,
        body.internal_note || null,
        portalAccess,
        passwordHash,
        body.discount_pct != null ? Number(body.discount_pct) : null,
      ]
    );

    const builderId = ins.insertId;
    const customerId = await syncCustomerForBuilder(pool, { ...body, email }, builderId, null);

    res.status(201).json({
      success: true,
      data: { id: builderId, customer_id: customerId, temp_password: tempPassword },
    });
  } catch (e) {
    console.error('createBuilder:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function updateBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const [existing] = await pool.query('SELECT * FROM builders WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Builder not found' });
    const cur = existing[0];

    const regions = body.regions !== undefined ? JSON.stringify(body.regions) : cur.regions;

    await pool.execute(
      `UPDATE builders SET
        first_name = ?, last_name = ?, email = ?, phone = ?, company = ?, website = ?,
        type = ?, status = ?, regions = ?, avg_ticket = ?, annual_projects = ?,
        source = ?, referred_by = ?, internal_note = ?, discount_pct = ?,
        portal_access = COALESCE(?, portal_access), portal_blocked = COALESCE(?, portal_blocked)
       WHERE id = ?`,
      [
        body.first_name ?? cur.first_name,
        body.last_name ?? cur.last_name,
        (body.email || cur.email).toLowerCase(),
        body.phone !== undefined ? body.phone : cur.phone,
        body.company !== undefined ? body.company : cur.company,
        body.website !== undefined ? body.website : cur.website,
        body.type ?? cur.type,
        body.status ?? cur.status,
        regions,
        body.avg_ticket !== undefined ? body.avg_ticket : cur.avg_ticket,
        body.annual_projects !== undefined ? body.annual_projects : cur.annual_projects,
        body.source !== undefined ? body.source : cur.source,
        body.referred_by !== undefined ? body.referred_by : cur.referred_by,
        body.internal_note !== undefined ? body.internal_note : cur.internal_note,
        body.discount_pct !== undefined ? body.discount_pct : cur.discount_pct,
        body.portal_access !== undefined ? (body.portal_access ? 1 : 0) : null,
        body.portal_blocked !== undefined ? (body.portal_blocked ? 1 : 0) : null,
        id,
      ]
    );

    if (body.portal_password) {
      const hash = await bcrypt.hash(String(body.portal_password), 10);
      await pool.execute('UPDATE builders SET portal_password_hash = ?, portal_access = 1 WHERE id = ?', [
        hash,
        id,
      ]);
    }

    await syncCustomerForBuilder(
      pool,
      { ...cur, ...body, email: (body.email || cur.email).toLowerCase() },
      id,
      cur.customer_id
    );

    res.json({ success: true, message: 'Builder updated' });
  } catch (e) {
    console.error('updateBuilder:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deactivateBuilder(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    await pool.execute(
      "UPDATE builders SET status = 'inactive', portal_blocked = 1 WHERE id = ?",
      [id]
    );
    res.json({ success: true, message: 'Builder deactivated' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** Builder portal: projects for logged-in partner */
export async function listBuilderPortalProjects(req, res) {
  try {
    const pool = await getDBConnection();
    const auth = req.builderAuth;
    const [b] = await pool.query('SELECT customer_id FROM builders WHERE id = ?', [auth.builderId]);
    if (!b.length || !b[0].customer_id) {
      return res.json({ success: true, data: [] });
    }
    const cid = b[0].customer_id;
    const [rows] = await pool.query(
      `SELECT id, name, address, status, completion_percentage, start_date, end_date_estimated,
              flooring_type, total_sqft, project_number
       FROM projects
       WHERE builder_id = ? AND (deleted_at IS NULL)
       ORDER BY updated_at DESC`,
      [cid]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getBuilderPortalProject(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.id, 10);
    const [b] = await pool.query('SELECT customer_id FROM builders WHERE id = ?', [
      req.builderAuth.builderId,
    ]);
    if (!b.length) return res.status(403).json({ success: false, error: 'Access denied' });
    const [rows] = await pool.query(
      `SELECT id, name, address, status, completion_percentage, start_date, end_date_estimated,
              end_date_actual, flooring_type, total_sqft, service_type, project_number, notes
       FROM projects WHERE id = ? AND builder_id = ? AND (deleted_at IS NULL)`,
      [projectId, b[0].customer_id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Project not found' });

    const [checklist] = await pool.query(
      `SELECT id, category, item, checked, notes, assigned_to
       FROM project_checklist WHERE project_id = ? AND visible_to_builder = 1
       ORDER BY sort_order ASC, id ASC`,
      [projectId]
    );

    const [photos] = await pool.query(
      `SELECT id, phase, file_path, file_url, caption, created_at
       FROM project_photos WHERE project_id = ? ORDER BY created_at DESC`,
      [projectId]
    );

    res.json({
      success: true,
      data: { project: rows[0], checklist, photos },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postAdminResetPassword(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const temp = randomTempPassword();
    const hash = await bcrypt.hash(temp, 10);
    await pool.execute(
      'UPDATE builders SET portal_password_hash = ?, portal_access = 1, portal_blocked = 0 WHERE id = ?',
      [hash, id]
    );
    res.json({ success: true, data: { temp_password: temp } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderRoutes(app) {
  app.get('/api/builders', requireAuth, requirePermission('builders.view'), listBuilders);
  app.post('/api/builders', requireAuth, requirePermission('builders.edit'), createBuilder);
  app.get('/api/builders/:id', requireAuth, requirePermission('builders.view'), getBuilder);
  app.put('/api/builders/:id', requireAuth, requirePermission('builders.edit'), updateBuilder);
  app.delete('/api/builders/:id', requireAuth, requirePermission('builders.edit'), deactivateBuilder);
  app.post(
    '/api/builders/:id/reset-portal-password',
    requireAuth,
    requirePermission('builders.edit'),
    postAdminResetPassword
  );

  app.get('/api/builder-projects', requireBuilderAuth, listBuilderPortalProjects);
  app.get('/api/builder-projects/:id', requireBuilderAuth, getBuilderPortalProject);
}
