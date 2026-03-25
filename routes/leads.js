/**
 * Leads API — list, get, update (CRM)
 */
import { getDBConnection, isDatabaseConfigured } from '../config/db.js';
import { getLeadsTableColumns } from '../lib/leadColumns.js';
import { extractMarketingFromBody, MARKETING_KEYS } from '../lib/marketingLeadFields.js';

export async function listLeads(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const pool = await getDBConnection();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const ownerId = req.query.owner_id || null;
    const pipelineStageId = req.query.pipeline_stage_id || null;
    
    let whereClause = '1=1';
    const params = [];
    
    if (status) {
      whereClause += ' AND l.status = ?';
      params.push(status);
    }
    if (ownerId) {
      whereClause += ' AND l.owner_id = ?';
      params.push(ownerId);
    }
    if (pipelineStageId) {
      whereClause += ' AND l.pipeline_stage_id = ?';
      params.push(pipelineStageId);
    }
    const utmCampaign = (req.query.utm_campaign || '').trim();
    if (utmCampaign) {
      whereClause += ' AND l.utm_campaign = ?';
      params.push(utmCampaign);
    }
    const mPlatform = (req.query.marketing_platform || '').trim();
    if (mPlatform) {
      whereClause += ' AND l.marketing_platform = ?';
      params.push(mPlatform);
    }
    const createdFrom = (req.query.created_from || req.query.date_from || '').trim().slice(0, 10);
    if (createdFrom && /^\d{4}-\d{2}-\d{2}$/.test(createdFrom)) {
      whereClause += ' AND DATE(l.created_at) >= ?';
      params.push(createdFrom);
    }
    const createdTo = (req.query.created_to || req.query.date_to || '').trim().slice(0, 10);
    if (createdTo && /^\d{4}-\d{2}-\d{2}$/.test(createdTo)) {
      whereClause += ' AND DATE(l.created_at) <= ?';
      params.push(createdTo);
    }

    const qRaw = (req.query.q || req.query.search || '').trim().slice(0, 120);
    if (qRaw) {
      const needle = qRaw.toLowerCase();
      const phoneDigits = qRaw.replace(/\D/g, '');
      const subconds = [
        'INSTR(LOWER(COALESCE(l.name,\'\')), ?) > 0',
        'INSTR(LOWER(COALESCE(l.email,\'\')), ?) > 0',
      ];
      const searchParams = [needle, needle];
      if (phoneDigits.length >= 3) {
        subconds.push(
          'INSTR(REPLACE(REPLACE(COALESCE(l.phone,\'\'),\' \',\'\'),\'-\',\'\'), ?) > 0'
        );
        searchParams.push(phoneDigits);
      }
      if (/^\d{1,10}$/.test(qRaw)) {
        subconds.unshift('l.id = ?');
        searchParams.unshift(parseInt(qRaw, 10));
      }
      whereClause += ` AND (${subconds.join(' OR ')})`;
      params.push(...searchParams);
    }

    const [rows] = await pool.query(
      `SELECT l.*, u.name as owner_name, ps.name as pipeline_stage_name, ps.slug as pipeline_stage_slug, ps.color as pipeline_stage_color
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE ${whereClause}
       ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM leads l WHERE ${whereClause}`, params);
    res.json({ success: true, data: rows, total, page, limit });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getLead(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const pool = await getDBConnection();
    const [rows] = await pool.query('SELECT * FROM leads WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createLead(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  
  const {
    name,
    email,
    phone,
    zipcode,
    message,
    source,
    form_type,
    status,
    priority,
    owner_id,
    pipeline_stage_id,
    estimated_value,
    notes,
    ...restBody
  } = req.body;
  
  // Validation
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Name is required (min 2 characters)' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Valid email is required' });
  }
  if (!phone || phone.trim().length < 10) {
    return res.status(400).json({ success: false, error: 'Phone is required' });
  }
  const zipClean = (zipcode || '').replace(/\D/g, '');
  if (!zipClean || zipClean.length < 5) {
    return res.status(400).json({ success: false, error: 'Valid 5-digit zip code is required' });
  }
  
  try {
    const pool = await getDBConnection();
    const userId = req.session?.user?.id;

    let finalPipelineStageId =
      pipeline_stage_id != null && pipeline_stage_id !== ''
        ? parseInt(pipeline_stage_id, 10)
        : null;
    if (!Number.isFinite(finalPipelineStageId)) finalPipelineStageId = null;

    let finalStatus = (status || '').trim() || 'lead_received';

    if (finalPipelineStageId) {
      const [ps] = await pool.execute('SELECT slug FROM pipeline_stages WHERE id = ? LIMIT 1', [finalPipelineStageId]);
      if (ps.length > 0) finalStatus = ps[0].slug;
    } else {
      const [ps] = await pool.execute(
        'SELECT id, slug FROM pipeline_stages WHERE slug = ? ORDER BY order_num LIMIT 1',
        [finalStatus]
      );
      if (ps.length > 0) {
        finalPipelineStageId = ps[0].id;
        finalStatus = ps[0].slug;
      }
    }
    if (!finalPipelineStageId) {
      const [ps] = await pool.execute(
        "SELECT id, slug FROM pipeline_stages WHERE slug = 'lead_received' ORDER BY order_num LIMIT 1"
      );
      if (ps.length > 0) {
        finalPipelineStageId = ps[0].id;
        finalStatus = 'lead_received';
      }
    }

    const colSet = await getLeadsTableColumns(pool);
    const marketing = extractMarketingFromBody({ ...restBody, ...req.body });
    const cols = [
      'name',
      'email',
      'phone',
      'zipcode',
      'message',
      'source',
      'form_type',
      'status',
      'priority',
      'owner_id',
      'pipeline_stage_id',
      'estimated_value',
      'notes',
    ];
    const vals = [
      name.trim(),
      email.trim(),
      phone.trim(),
      zipClean.slice(0, 5),
      message || null,
      source || 'Manual',
      form_type || 'manual',
      finalStatus,
      priority || 'medium',
      owner_id || userId || null,
      finalPipelineStageId,
      estimated_value || null,
      notes || null,
    ];
    for (const key of MARKETING_KEYS) {
      if (colSet.has(key)) {
        cols.push(key);
        vals.push(marketing[key]);
      }
    }
    const colSql = cols.map((c) => `\`${c}\``).join(', ');
    const qmarks = cols.map(() => '?').join(', ');
    const [result] = await pool.execute(
      `INSERT INTO leads (${colSql}, \`created_at\`) VALUES (${qmarks}, NOW())`,
      vals
    );
    
    // Get created lead
    const [created] = await pool.execute(
      `SELECT l.*, u.name as owner_name, ps.name as pipeline_stage_name, ps.slug as pipeline_stage_slug
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [result.insertId]
    );
    
    return res.status(201).json({ success: true, data: created[0], lead_id: result.insertId });
  } catch (error) {
    console.error('Create lead error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateLead(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
  const body = req.body || {};
  const set = [];
  const values = [];
  
  try {
    const pool = await getDBConnection();
    const colSet = await getLeadsTableColumns(pool);
    const allowed = [
      'name',
      'email',
      'phone',
      'zipcode',
      ...(colSet.has('address') ? ['address'] : []),
      'message',
      'status',
      'priority',
      'owner_id',
      'pipeline_stage_id',
      'estimated_value',
      'notes',
      ...MARKETING_KEYS.filter((k) => colSet.has(k)),
    ];
    
    // If status is updated but pipeline_stage_id is not, try to find matching stage
    if (body.status && !body.pipeline_stage_id) {
      const [stages] = await pool.execute(
        'SELECT id FROM pipeline_stages WHERE slug = ? LIMIT 1',
        [body.status]
      );
      if (stages.length > 0) {
        body.pipeline_stage_id = stages[0].id;
      }
    }
    
    // If pipeline_stage_id is updated but status is not, get the slug
    if (body.pipeline_stage_id && !body.status) {
      const [stages] = await pool.execute(
        'SELECT slug FROM pipeline_stages WHERE id = ? LIMIT 1',
        [body.pipeline_stage_id]
      );
      if (stages.length > 0) {
        body.status = stages[0].slug;
      }
    }
    
    for (const key of allowed) {
      if (body[key] !== undefined) {
        set.push(`\`${key}\` = ?`);
        let val = body[key];
        if (val === undefined) val = null;
        else if (['owner_id', 'pipeline_stage_id'].includes(key)) val = val === '' || val == null ? null : parseInt(val, 10) || null;
        else if (key === 'estimated_value') val = val === '' || val == null ? null : parseFloat(val) || null;
        else if (key === 'zipcode' && val !== '' && val != null) {
          val = String(val).replace(/\D/g, '').slice(0, 10);
        } else if (key === 'address' && val != null) {
          val = String(val).trim().slice(0, 500) || null;
        } else if (key === 'name' && val != null) val = String(val).trim().slice(0, 255);
        else if (key === 'email' && val != null) val = String(val).trim().slice(0, 255);
        else if (key === 'phone' && val != null) val = String(val).trim().slice(0, 50);
        values.push(val);
      }
    }

    const willName = body.name !== undefined;
    const willEmail = body.email !== undefined;
    const willPhone = body.phone !== undefined;
    if (willName && String(body.name || '').trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Nome deve ter pelo menos 2 caracteres' });
    }
    if (willEmail && body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) {
      return res.status(400).json({ success: false, error: 'Email inválido' });
    }
    if (willPhone && String(body.phone || '').trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Telefone inválido' });
    }
    if (body.zipcode !== undefined) {
      const z = String(body.zipcode || '').replace(/\D/g, '');
      if (z && z.length < 5) {
        return res.status(400).json({ success: false, error: 'ZIP deve ter pelo menos 5 dígitos' });
      }
    }
    
    if (set.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
    
    values.push(id);
    await pool.execute(`UPDATE leads SET ${set.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
    
    // Get updated lead with joins
    const [rows] = await pool.query(
      `SELECT l.*, u.name as owner_name, ps.name as pipeline_stage_name, ps.slug as pipeline_stage_slug, ps.color as pipeline_stage_color
       FROM leads l
       LEFT JOIN users u ON l.owner_id = u.id
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [id]
    );
    
    return res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('Update lead error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}

async function execIgnoreNoSuchTable(conn, sql, params) {
  try {
    await conn.execute(sql, params);
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }
}

/** DELETE lead and related rows (best-effort per table). */
export async function deleteLead(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

  let conn;
  try {
    const pool = await getDBConnection();
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const leadId = id;
    await execIgnoreNoSuchTable(conn, 'DELETE FROM interactions WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM tasks WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM lead_qualification WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM activities WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM proposals WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM quotes WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM estimates WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM measurements WHERE lead_id = ?', [leadId]);
    await execIgnoreNoSuchTable(conn, 'DELETE FROM visits WHERE lead_id = ?', [leadId]);

    const [result] = await conn.execute('DELETE FROM leads WHERE id = ?', [leadId]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    await conn.commit();
    return res.json({ success: true, message: 'Lead deleted' });
  } catch (e) {
    if (conn) await conn.rollback();
    console.error('Delete lead error:', e);
    return res.status(500).json({ success: false, error: e.message || 'Failed to delete lead' });
  } finally {
    if (conn) conn.release();
  }
}
