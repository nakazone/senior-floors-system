/**
 * Client invoices from approved quotes.
 */
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import * as inv from '../modules/quotes/quoteInvoiceBusiness.js';

export async function listQuoteInvoices(req, res) {
  try {
    const quoteId = parseInt(req.params.id, 10);
    if (!quoteId) return res.status(400).json({ success: false, error: 'Invalid quote id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const data = await inv.listInvoicesForQuote(pool, quoteId);
    res.json({ success: true, data });
  } catch (e) {
    console.error('listQuoteInvoices:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteInvoice(req, res) {
  try {
    const quoteId = parseInt(req.params.id, 10);
    if (!quoteId) return res.status(400).json({ success: false, error: 'Invalid quote id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await inv.createQuoteInvoice(pool, quoteId, req.body || {}, req.session?.userId);
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    res.status(201).json({ success: true, data: r.data });
  } catch (e) {
    console.error('postQuoteInvoice:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function streamQuoteInvoicePdf(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const pdf = await inv.getInvoicePdfBuffer(pool, id);
    if (!pdf.ok) return res.status(404).json({ success: false, error: pdf.error || 'PDF not found' });
    const fname = `invoice-${pdf.invoice_number || id}.pdf`.replace(/[^\w.-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    res.send(pdf.buffer);
  } catch (e) {
    console.error('streamQuoteInvoicePdf:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteInvoiceSendEmail(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await inv.mailQuoteInvoice(pool, id, {
      to: req.body?.to,
      subject: req.body?.subject,
      html: req.body?.html,
    });
    if (!r.ok) {
      const status = String(r.error || '').toLowerCase().includes('configurado') ? 503 : 400;
      return res.status(status).json({ success: false, error: r.error });
    }
    res.json({ success: true, message_id: r.id, to: r.to });
  } catch (e) {
    console.error('postQuoteInvoiceSendEmail:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteInvoiceMarkPaid(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ok = await inv.markInvoicePaid(pool, id);
    if (!ok) return res.status(404).json({ success: false, error: 'Invoice not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('postQuoteInvoiceMarkPaid:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteQuoteInvoiceHandler(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await inv.deleteQuoteInvoice(pool, id);
    if (!r.ok) {
      const status = r.error === 'Invoice not found' ? 404 : 400;
      return res.status(status).json({ success: false, error: r.error });
    }
    res.json({ success: true, invoice_number: r.invoice_number });
  } catch (e) {
    console.error('deleteQuoteInvoice:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerQuoteInvoiceRoutes(app) {
  app.get('/api/quotes/:id/invoices', requireAuth, requirePermission('quotes.view'), listQuoteInvoices);
  app.post('/api/quotes/:id/invoices', requireAuth, requirePermission('quotes.edit'), postQuoteInvoice);
  app.get('/api/quote-invoices/:id/pdf', requireAuth, requirePermission('quotes.view'), streamQuoteInvoicePdf);
  app.post(
    '/api/quote-invoices/:id/send-email',
    requireAuth,
    requirePermission('quotes.edit'),
    postQuoteInvoiceSendEmail
  );
  app.post(
    '/api/quote-invoices/:id/mark-paid',
    requireAuth,
    requirePermission('quotes.edit'),
    postQuoteInvoiceMarkPaid
  );
  app.delete(
    '/api/quote-invoices/:id',
    requireAuth,
    requirePermission('quotes.edit'),
    deleteQuoteInvoiceHandler
  );
}
