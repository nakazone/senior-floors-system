/**
 * Quotes API - Quotes/Orçamentos management
 */
import { getDBConnection } from '../config/db.js';
import { setLeadPipelineBySlug } from '../lib/pipelineAutomation.js';

export async function listQuotes(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const customerId = req.query.customer_id || null;
    const leadId = req.query.lead_id || null;

    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (customerId) {
      whereClause += ' AND customer_id = ?';
      params.push(customerId);
    }
    if (leadId) {
      whereClause += ' AND lead_id = ?';
      params.push(leadId);
    }

    const [rows] = await pool.query(
      `SELECT q.*, 
              c.name as customer_name, c.email as customer_email,
              l.name as lead_name, l.email as lead_email
       FROM quotes q
       LEFT JOIN customers c ON q.customer_id = c.id
       LEFT JOIN leads l ON q.lead_id = l.id
       WHERE ${whereClause}
       ORDER BY q.created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM quotes WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List quotes error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getQuote(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [quotes] = await pool.query('SELECT * FROM quotes WHERE id = ?', [req.params.id]);
    if (quotes.length === 0) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }

    const quote = quotes[0];

    // Buscar items do quote
    const [items] = await pool.query('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id', [req.params.id]);

    res.json({ success: true, data: { ...quote, items } });
  } catch (error) {
    console.error('Get quote error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createQuote(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { lead_id, customer_id, project_id, total_amount, labor_amount, materials_amount, 
            status, items, notes, expiration_date } = req.body;

    if (!total_amount) {
      return res.status(400).json({ success: false, error: 'Total amount is required' });
    }

    // Gerar número do quote
    const [lastQuote] = await pool.query(
      "SELECT quote_number FROM quotes WHERE quote_number IS NOT NULL ORDER BY id DESC LIMIT 1"
    );
    
    let quoteNumber = 'Q-2024-0001';
    if (lastQuote.length > 0 && lastQuote[0].quote_number) {
      const match = lastQuote[0].quote_number.match(/Q-(\d{4})-(\d+)/);
      if (match) {
        const year = new Date().getFullYear();
        const num = parseInt(match[2]) + 1;
        quoteNumber = `Q-${year}-${String(num).padStart(4, '0')}`;
      }
    }

    const [result] = await pool.execute(
      `INSERT INTO quotes (lead_id, customer_id, project_id, total_amount, labor_amount, materials_amount, 
                          status, quote_number, expiration_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lead_id || null, customer_id || null, project_id || null, total_amount, 
       labor_amount || 0, materials_amount || 0, status || 'draft', quoteNumber,
       expiration_date || null, notes || null, req.session.userId || null]
    );

    const quoteId = result.insertId;

    // Inserir items se fornecidos
    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        await pool.execute(
          `INSERT INTO quote_items (quote_id, description, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?)`,
          [quoteId, item.description, item.quantity || 1, item.unit_price || 0, item.total_price || 0]
        );
      }
    }

    const st = String(status || 'draft').toLowerCase();
    if (lead_id && ['sent', 'approved', 'accepted'].includes(st)) {
      await setLeadPipelineBySlug(lead_id, 'proposal_sent');
    }

    res.status(201).json({ success: true, data: { id: quoteId, quote_number: quoteNumber }, message: 'Quote created' });
  } catch (error) {
    console.error('Create quote error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateQuote(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [quoteRows] = await pool.query('SELECT lead_id, status FROM quotes WHERE id = ?', [req.params.id]);
    const existing = quoteRows[0];
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }
    const prevStatus = String(existing.status || '').toLowerCase();

    const updates = [];
    const values = [];
    const allowedFields = ['status', 'total_amount', 'labor_amount', 'materials_amount', 
                          'notes', 'expiration_date', 'sent_at', 'viewed_at', 'approved_at'];

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
      `UPDATE quotes SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    const newStatus = req.body.status != null ? String(req.body.status).toLowerCase() : prevStatus;
    const becameSent = ['sent', 'approved', 'accepted'].includes(newStatus) && !['sent', 'approved', 'accepted'].includes(prevStatus);
    if (becameSent && existing.lead_id) {
      await setLeadPipelineBySlug(existing.lead_id, 'proposal_sent');
    }

    res.json({ success: true, message: 'Quote updated' });
  } catch (error) {
    console.error('Update quote error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
