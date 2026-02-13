/**
 * Visits/Schedule API - Site visits and scheduling
 */
import { getDBConnection } from '../config/db.js';

export async function listVisits(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const sellerId = req.query.seller_id || null;
    const leadId = req.query.lead_id || null;
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;

    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND v.status = ?';
      params.push(status);
    }
    if (sellerId) {
      whereClause += ' AND v.assigned_to = ?';
      params.push(sellerId);
    }
    if (leadId) {
      whereClause += ' AND v.lead_id = ?';
      params.push(leadId);
    }
    if (dateFrom) {
      whereClause += ' AND scheduled_at >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClause += ' AND scheduled_at <= ?';
      params.push(dateTo);
    }

    const [rows] = await pool.query(
      `SELECT v.*, 
              l.name as lead_name, l.email as lead_email, l.phone as lead_phone,
              u.name as assigned_to_name
       FROM visits v
       LEFT JOIN leads l ON v.lead_id = l.id
       LEFT JOIN users u ON u.id = COALESCE(v.assigned_to, v.seller_id)
       WHERE ${whereClause}
       ORDER BY v.scheduled_at ASC 
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM visits v WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List visits error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getVisit(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query('SELECT * FROM visits WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Visit not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get visit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createVisit(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { lead_id, customer_id, project_id, scheduled_at, seller_id, assigned_to, technician_id, address, notes } = req.body;
    const assignedUserId = assigned_to != null ? assigned_to : seller_id;

    if (!scheduled_at) {
      return res.status(400).json({ success: false, error: 'Scheduled date/time is required' });
    }

    const [result] = await pool.execute(
      `INSERT INTO visits (lead_id, customer_id, project_id, scheduled_at, seller_id, technician_id, address, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
      [lead_id || null, customer_id || null, project_id || null, scheduled_at,
       assignedUserId || null, technician_id || null, address || null, notes || null]
    );

    const visitId = result.insertId;

    // Move lead to "Visita Agendada" when scheduling a visit for a lead
    if (lead_id) {
      try {
        const [stageRows] = await pool.query(
          "SELECT id FROM pipeline_stages WHERE slug = 'visit_scheduled' LIMIT 1"
        );
        if (stageRows.length > 0) {
          await pool.execute(
            'UPDATE leads SET pipeline_stage_id = ?, status = ? WHERE id = ?',
            [stageRows[0].id, 'visit_scheduled', lead_id]
          );
        }
      } catch (updateErr) {
        console.warn('Could not update lead pipeline stage:', updateErr.message);
      }
    }

    res.status(201).json({ success: true, data: { id: visitId }, message: 'Visit scheduled' });
  } catch (error) {
    console.error('Create visit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateVisit(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const updates = [];
    const values = [];
    const allowedFields = ['scheduled_at', 'ended_at', 'seller_id', 'technician_id', 'address', 'notes', 'status'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(
      `UPDATE visits SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Visit updated' });
  } catch (error) {
    console.error('Update visit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
