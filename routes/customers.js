/**
 * Clients API — tabela `customers` (builders, clientes finais convertidos de leads).
 */
import { getDBConnection } from '../config/db.js';
import { ensureClientFromLead } from '../modules/clients/leadToClient.js';

export async function listCustomers(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const search = req.query.search || null;

    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const [[{ lc }]] = await pool.query(
      `SELECT COUNT(*) AS lc FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'lead_id'`
    );
    const selectCols =
      Number(lc) > 0
        ? 'id, lead_id, name, email, phone, city, state, zipcode, customer_type, owner_id, status, created_at'
        : 'id, name, email, phone, city, state, zipcode, customer_type, owner_id, status, created_at';

    const [rows] = await pool.query(
      `SELECT ${selectCols} FROM customers WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM customers WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { name, email, phone, address, city, state, zipcode, customer_type, owner_id, notes, lead_id } =
      req.body || {};

    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Nome e email são obrigatórios' });
    }
    const phoneVal = phone != null && String(phone).trim().length >= 3 ? String(phone).trim() : '—';

    const leadIdNum =
      lead_id != null && lead_id !== '' ? parseInt(String(lead_id), 10) : null;
    const leadOk = Number.isFinite(leadIdNum) && leadIdNum > 0 ? leadIdNum : null;

    const [colRows] = await pool.query(
      `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'lead_id'`
    );
    const hasLeadId = colRows.length > 0;

    if (hasLeadId && leadOk) {
      const [dup] = await pool.query('SELECT id FROM customers WHERE lead_id = ? LIMIT 1', [leadOk]);
      if (dup.length) {
        return res.status(409).json({
          success: false,
          error: 'Já existe cliente ligado a este lead',
          data: { id: dup[0].id },
        });
      }
    }

    if (hasLeadId && leadOk) {
      const [result] = await pool.execute(
        `INSERT INTO customers (name, email, phone, address, city, state, zipcode, customer_type, owner_id, notes, status, lead_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          String(name).trim().slice(0, 255),
          String(email).trim().slice(0, 255),
          phoneVal.slice(0, 50),
          address != null ? String(address).trim().slice(0, 5000) || null : null,
          city != null ? String(city).trim().slice(0, 100) || null : null,
          state != null ? String(state).trim().slice(0, 50) || null : null,
          zipcode != null ? String(zipcode).replace(/\D/g, '').slice(0, 10) || null : null,
          customer_type || 'residential',
          owner_id != null && owner_id !== '' ? parseInt(String(owner_id), 10) || null : null,
          notes != null ? String(notes).trim().slice(0, 8000) || null : null,
          leadOk,
        ]
      );
      return res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Client created' });
    }

    const [result] = await pool.execute(
      `INSERT INTO customers (name, email, phone, address, city, state, zipcode, customer_type, owner_id, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        String(name).trim().slice(0, 255),
        String(email).trim().slice(0, 255),
        phoneVal.slice(0, 50),
        address != null ? String(address).trim().slice(0, 5000) || null : null,
        city != null ? String(city).trim().slice(0, 100) || null : null,
        state != null ? String(state).trim().slice(0, 50) || null : null,
        zipcode != null ? String(zipcode).replace(/\D/g, '').slice(0, 10) || null : null,
        customer_type || 'residential',
        owner_id != null && owner_id !== '' ? parseInt(String(owner_id), 10) || null : null,
        notes != null ? String(notes).trim().slice(0, 8000) || null : null,
      ]
    );

    res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Client created' });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/** GET cliente ligado a um lead (lead_id). */
export async function getCustomerByLead(req, res) {
  try {
    const leadId = parseInt(req.params.leadId, 10);
    if (!leadId) return res.status(400).json({ success: false, error: 'Invalid lead id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const [colRows] = await pool.query(
      `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'lead_id'`
    );
    if (!colRows.length) {
      return res.json({ success: true, data: null, message: 'lead_id column missing; run migrate:customers-lead-id' });
    }

    const [rows] = await pool.query('SELECT * FROM customers WHERE lead_id = ? LIMIT 1', [leadId]);
    if (!rows.length) return res.json({ success: true, data: null });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('getCustomerByLead:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/** POST corpo { lead_id, customer_type? } — força conversão (qualquer estágio). */
export async function createCustomerFromLead(req, res) {
  try {
    const leadId = parseInt(req.body?.lead_id, 10);
    if (!leadId) return res.status(400).json({ success: false, error: 'lead_id é obrigatório' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const [leads] = await pool.query(
      `SELECT l.*, ps.slug AS pipeline_stage_slug
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [leadId]
    );
    if (!leads.length) return res.status(404).json({ success: false, error: 'Lead not found' });

    const r = await ensureClientFromLead(pool, leads[0], {
      force: true,
      customer_type: req.body?.customer_type,
    });
    if (r.reason === 'invalid_email') {
      return res.status(400).json({
        success: false,
        error: 'Lead sem email válido — corrija no lead antes de criar cliente',
      });
    }
    if (r.created && r.customer_id) {
      return res.status(201).json({
        success: true,
        data: { id: r.customer_id },
        message: 'Client created from lead',
      });
    }
    if (r.customer_id) {
      return res.status(200).json({
        success: true,
        data: { id: r.customer_id },
        message: 'Client already linked to this lead',
      });
    }
    return res.status(400).json({ success: false, error: r.reason || 'Could not create client' });
  } catch (error) {
    console.error('createCustomerFromLead:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { name, email, phone, address, city, state, zipcode, customer_type, owner_id, status, notes } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (address !== undefined) { updates.push('address = ?'); values.push(address); }
    if (city !== undefined) { updates.push('city = ?'); values.push(city); }
    if (state !== undefined) { updates.push('state = ?'); values.push(state); }
    if (zipcode !== undefined) { updates.push('zipcode = ?'); values.push(zipcode); }
    if (customer_type !== undefined) { updates.push('customer_type = ?'); values.push(customer_type); }
    if (owner_id !== undefined) { updates.push('owner_id = ?'); values.push(owner_id); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Client updated' });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
