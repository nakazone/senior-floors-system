/**
 * Quotes API - Quotes/Orçamentos management
 */
import fs from 'fs';
import { getDBConnection } from '../config/db.js';
import { setLeadPipelineBySlug } from '../lib/pipelineAutomation.js';
import { QUOTE_PDF_SUBDIR, resolvedPdfAbsolutePath } from '../lib/quotePdfUpload.js';

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

    const data = { ...quote, items };
    if (quote.pdf_path) {
      data.invoice_pdf_url = `/api/quotes/${quote.id}/invoice-pdf`;
    }
    res.json({ success: true, data });
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

async function generateNextQuoteNumber(pool) {
  const [lastQuote] = await pool.query(
    "SELECT quote_number FROM quotes WHERE quote_number IS NOT NULL ORDER BY id DESC LIMIT 1"
  );
  let quoteNumber = `Q-${new Date().getFullYear()}-0001`;
  if (lastQuote.length > 0 && lastQuote[0].quote_number) {
    const match = lastQuote[0].quote_number.match(/Q-(\d{4})-(\d+)/);
    if (match) {
      const year = new Date().getFullYear();
      const num = parseInt(match[2], 10) + 1;
      quoteNumber = `Q-${year}-${String(num).padStart(4, '0')}`;
    }
  }
  return quoteNumber;
}

/**
 * POST multipart: file (PDF), total_amount, lead_id opcional, notes opcional
 */
export async function createQuoteFromInvoicePdf(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Selecione um ficheiro PDF.' });
  }
  const totalRaw = req.body.total_amount;
  const total = parseFloat(String(totalRaw == null ? '' : totalRaw).replace(',', '.'), 10);
  if (!Number.isFinite(total) || total < 0) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      /* ignore */
    }
    return res.status(400).json({ success: false, error: 'Indique o valor final do orçamento (número válido).' });
  }
  const leadRaw = req.body.lead_id;
  const lead_id =
    leadRaw === '' || leadRaw === undefined || leadRaw === null
      ? null
      : parseInt(String(leadRaw), 10) || null;
  const extraNotes = req.body.notes != null ? String(req.body.notes).trim().slice(0, 2000) : '';
  const baseNote =
    'Orçamento importado via PDF (ex.: Invoice2Go). Valor final registado no CRM.';
  const notes = extraNotes ? `${baseNote}\n${extraNotes}` : baseNote;

  const relativePath = `${QUOTE_PDF_SUBDIR}/${req.file.filename}`;

  try {
    const pool = await getDBConnection();
    if (!pool) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        /* ignore */
      }
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const quoteNumber = await generateNextQuoteNumber(pool);

    const [result] = await pool.execute(
      `INSERT INTO quotes (lead_id, customer_id, project_id, total_amount, labor_amount, materials_amount,
                          status, quote_number, expiration_date, notes, created_by, pdf_path)
       VALUES (?, NULL, NULL, ?, 0, 0, 'draft', ?, NULL, ?, ?, ?)`,
      [lead_id, total, quoteNumber, notes, req.session.userId || null, relativePath]
    );

    const quoteId = result.insertId;

    res.status(201).json({
      success: true,
      data: {
        id: quoteId,
        quote_number: quoteNumber,
        invoice_pdf_url: `/api/quotes/${quoteId}/invoice-pdf`,
      },
      message: 'Quote criado com PDF anexado.',
    });
  } catch (error) {
    console.error('createQuoteFromInvoicePdf error:', error);
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      /* ignore */
    }
    if (error.code === 'ER_BAD_FIELD_ERROR' && String(error.message || '').includes('pdf_path')) {
      return res.status(500).json({
        success: false,
        error:
          'Coluna pdf_path em falta na tabela quotes. Execute: ALTER TABLE quotes ADD COLUMN pdf_path VARCHAR(500) NULL;',
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function streamQuoteInvoicePdf(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    const [rows] = await pool.query('SELECT id, pdf_path FROM quotes WHERE id = ?', [id]);
    if (!rows.length || !rows[0].pdf_path) {
      return res.status(404).json({ success: false, error: 'PDF não disponível para este quote.' });
    }
    const abs = resolvedPdfAbsolutePath(rows[0].pdf_path);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({ success: false, error: 'Ficheiro não encontrado no servidor.' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="orcamento.pdf"');
    const stream = fs.createReadStream(abs);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (e) {
    console.error('streamQuoteInvoicePdf:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
}
