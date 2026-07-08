/**
 * Client invoices issued from approved quotes.
 */
import { buildInvoicePdfBuffer } from './invoicePdf.js';
import { loadQuoteContext } from './quoteBusiness.js';
import { sendQuoteEmail } from './quoteMail.js';

function isQuoteApproved(status) {
  return ['approved', 'accepted'].includes(String(status || '').trim().toLowerCase());
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function defaultDueDate(days = 14) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function nextInvoiceNumber(pool) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const [rows] = await pool.query(
    `SELECT invoice_number FROM quote_invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length) {
    const m = String(rows[0].invoice_number || '').match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

function mapInvoiceRow(r) {
  return {
    id: r.id,
    quote_id: r.quote_id,
    project_id: r.project_id,
    customer_id: r.customer_id,
    invoice_number: r.invoice_number,
    invoice_type: r.invoice_type,
    amount: Number(r.amount),
    quote_total: r.quote_total != null ? Number(r.quote_total) : null,
    due_date: r.due_date,
    status: r.status,
    payment_instructions: r.payment_instructions,
    notes: r.notes,
    email_sent_at: r.email_sent_at,
    paid_at: r.paid_at,
    created_at: r.created_at,
    has_pdf: !!(r.pdf_blob && r.pdf_blob.length),
    pdf_url: `/api/quote-invoices/${r.id}/pdf`,
  };
}

export async function listInvoicesForQuote(pool, quoteId) {
  const [rows] = await pool.query(
    `SELECT id, quote_id, project_id, customer_id, invoice_number, invoice_type, amount, quote_total,
            due_date, status, payment_instructions, notes, email_sent_at, paid_at, created_at,
            (pdf_blob IS NOT NULL AND LENGTH(pdf_blob) > 0) AS has_pdf
     FROM quote_invoices WHERE quote_id = ? ORDER BY created_at DESC, id DESC`,
    [quoteId]
  );
  return rows.map((r) => ({
    ...mapInvoiceRow({ ...r, pdf_blob: r.has_pdf ? Buffer.from([1]) : null }),
    has_pdf: !!r.has_pdf,
  }));
}

function resolveInvoiceAmount(quoteTotal, body) {
  const total = roundMoney(quoteTotal);
  const type = String(body.invoice_type || body.amount_type || 'deposit').toLowerCase();
  if (type === 'full') return { invoice_type: 'full', amount: total };
  if (type === 'final') return { invoice_type: 'final', amount: total };
  if (type === 'progress') {
    const amt = roundMoney(body.custom_amount ?? body.amount);
    return { invoice_type: 'progress', amount: amt > 0 ? amt : total };
  }
  if (type === 'custom' || type === 'other') {
    const amt = roundMoney(body.custom_amount ?? body.amount);
    if (amt <= 0) throw new Error('Indique o valor do invoice.');
    return { invoice_type: type === 'other' ? 'other' : 'other', amount: amt };
  }
  const pct = Math.min(100, Math.max(1, parseInt(body.deposit_pct, 10) || 50));
  return { invoice_type: 'deposit', amount: roundMoney(total * (pct / 100)) };
}

export async function createQuoteInvoice(pool, quoteId, body, userId) {
  const ctx = await loadQuoteContext(pool, quoteId);
  if (!ctx) return { ok: false, error: 'Quote not found' };
  if (!isQuoteApproved(ctx.quote.status)) {
    return {
      ok: false,
      error: 'S� � poss�vel emitir invoice quando o or�amento est� aprovado. Guarde o or�amento com status Aprovado.',
    };
  }

  const quoteTotal = Number(ctx.quote.total_amount) || 0;
  if (quoteTotal <= 0) return { ok: false, error: 'O orçamento não tem valor total.' };

  let resolved;
  try {
    resolved = resolveInvoiceAmount(quoteTotal, body);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (resolved.amount <= 0) return { ok: false, error: 'Valor do invoice inválido.' };

  const invoiceNumber = await nextInvoiceNumber(pool);
  const dueDate = body.due_date ? String(body.due_date).slice(0, 10) : defaultDueDate(14);
  const paymentInstructions =
    body.payment_instructions != null && String(body.payment_instructions).trim()
      ? String(body.payment_instructions).trim()
      : null;
  const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;

  const [ins] = await pool.execute(
    `INSERT INTO quote_invoices
      (quote_id, project_id, customer_id, invoice_number, invoice_type, amount, quote_total,
       due_date, status, payment_instructions, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
    [
      quoteId,
      ctx.quote.project_id || null,
      ctx.quote.customer_id || null,
      invoiceNumber,
      resolved.invoice_type,
      resolved.amount,
      quoteTotal,
      dueDate,
      paymentInstructions,
      notes,
      userId || null,
    ]
  );

  const invoiceId = ins.insertId;
  const gen = await generateAndStoreInvoicePdf(pool, invoiceId);
  if (!gen.ok) return gen;

  const [rows] = await pool.query('SELECT * FROM quote_invoices WHERE id = ? LIMIT 1', [invoiceId]);
  return { ok: true, data: mapInvoiceRow(rows[0]) };
}

export async function generateAndStoreInvoicePdf(pool, invoiceId) {
  const [rows] = await pool.query(
    `SELECT qi.*, q.quote_number, q.total_amount, q.customer_id,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM quote_invoices qi
     INNER JOIN quotes q ON q.id = qi.quote_id
     LEFT JOIN customers c ON c.id = qi.customer_id
     WHERE qi.id = ? LIMIT 1`,
    [invoiceId]
  );
  if (!rows.length) return { ok: false, error: 'Invoice not found' };
  const inv = rows[0];
  const ctx = await loadQuoteContext(pool, inv.quote_id);
  if (!ctx) return { ok: false, error: 'Quote not found' };

  const pdfBuf = await buildInvoicePdfBuffer({
    invoice: inv,
    quote: ctx.quote,
    items: ctx.items,
    customer: {
      name: inv.customer_name || ctx.quote.customer_name,
      email: inv.customer_email || ctx.quote.customer_email,
      phone: inv.customer_phone || ctx.quote.customer_phone,
    },
  });
  await pool.execute('UPDATE quote_invoices SET pdf_blob = ? WHERE id = ?', [pdfBuf, invoiceId]);
  return { ok: true, buffer: pdfBuf };
}

export async function getInvoicePdfBuffer(pool, invoiceId) {
  const [rows] = await pool.query('SELECT id, invoice_number FROM quote_invoices WHERE id = ?', [invoiceId]);
  if (!rows.length) return { ok: false, error: 'Invoice not found' };
  const gen = await generateAndStoreInvoicePdf(pool, invoiceId);
  if (!gen.ok) return gen;
  return { ok: true, buffer: gen.buffer, invoice_number: rows[0].invoice_number };
}

export async function mailQuoteInvoice(pool, invoiceId, emailOpts = {}) {
  const [rows] = await pool.query(
    `SELECT qi.*, q.quote_number, c.email AS customer_email, c.name AS customer_name
     FROM quote_invoices qi
     INNER JOIN quotes q ON q.id = qi.quote_id
     LEFT JOIN customers c ON c.id = qi.customer_id
     WHERE qi.id = ? LIMIT 1`,
    [invoiceId]
  );
  if (!rows.length) return { ok: false, error: 'Invoice not found' };
  const inv = rows[0];
  const email = String(emailOpts.to || inv.customer_email || '').trim();
  if (!email) {
    return { ok: false, error: 'E-mail do cliente em falta. Associe um cliente com e-mail ou indique o destinatário.' };
  }

  const pdf = await getInvoicePdfBuffer(pool, invoiceId);
  if (!pdf.ok) return pdf;

  const invNum = inv.invoice_number || `INV-${invoiceId}`;
  const amount = roundMoney(inv.amount);
  const due = inv.due_date ? String(inv.due_date).slice(0, 10) : '';
  const html =
    emailOpts.html ||
    `<p>Hello${inv.customer_name ? ` ${inv.customer_name}` : ''},</p>
<p>Please find attached invoice <strong>${invNum}</strong> for <strong>$${amount.toFixed(2)}</strong>${due ? ` due by ${due}` : ''}.</p>
<p>This invoice relates to your approved quote <strong>${inv.quote_number || ''}</strong>.</p>
<p>— Senior Floors</p>`;

  const sent = await sendQuoteEmail({
    to: email,
    subject: emailOpts.subject || `Invoice ${invNum} — Senior Floors`,
    html,
    pdfBuffer: pdf.buffer,
    filename: `Senior-Floors-${invNum}.pdf`,
  });
  if (!sent.ok) return sent;

  await pool.execute(
    `UPDATE quote_invoices SET status = IF(status = 'paid', 'paid', 'sent'), email_sent_at = NOW() WHERE id = ?`,
    [invoiceId]
  );
  return { ok: true, id: sent.id, to: email };
}

export async function markInvoicePaid(pool, invoiceId) {
  const [r] = await pool.execute(
    `UPDATE quote_invoices SET status = 'paid', paid_at = NOW() WHERE id = ? AND status != 'void'`,
    [invoiceId]
  );
  return r.affectedRows > 0;
}

async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0]?.c) > 0;
}

async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

export async function deleteQuoteInvoice(pool, invoiceId) {
  const id = parseInt(invoiceId, 10);
  if (!id) return { ok: false, error: 'Invalid invoice id' };

  const [rows] = await pool.query(
    'SELECT id, invoice_number, status FROM quote_invoices WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) return { ok: false, error: 'Invoice not found' };

  const inv = rows[0];
  if (String(inv.status || '').toLowerCase() === 'paid') {
    return { ok: false, error: 'Não é possível apagar um invoice marcado como pago.' };
  }

  if (
    (await tableExists(pool, 'payment_receipts')) &&
    (await columnExists(pool, 'payment_receipts', 'invoice_id'))
  ) {
    await pool.execute('UPDATE payment_receipts SET invoice_id = NULL WHERE invoice_id = ?', [id]);
  }

  const [del] = await pool.execute('DELETE FROM quote_invoices WHERE id = ?', [id]);
  if (!del.affectedRows) return { ok: false, error: 'Invoice not found' };

  return { ok: true, invoice_number: inv.invoice_number };
}
