import * as calc from './calculations.js';
import * as repo from './quoteRepository.js';
import { buildQuotePdfBuffer } from './quotePdf.js';
import { sendQuoteEmail } from './quoteMail.js';

export function mapItemRow(dbRow) {
  if (!dbRow) return null;
  const quantity = Number(dbRow.quantity ?? dbRow.area_sqft) || 0;
  const rate = Number(dbRow.unit_price) || 0;
  const amount = Number(dbRow.total_price) || calc.lineAmount(quantity, rate);
  return {
    id: dbRow.id,
    quote_id: dbRow.quote_id,
    service_catalog_id: dbRow.service_catalog_id ?? null,
    description: dbRow.description || dbRow.name || dbRow.floor_type,
    unit_type: dbRow.unit_type || 'sq_ft',
    quantity,
    rate,
    unit_price: rate,
    amount,
    total_price: amount,
    notes: dbRow.notes || null,
    type: dbRow.type || 'service',
    floor_type: dbRow.floor_type,
    sort_order: dbRow.sort_order ?? 0,
  };
}

export async function loadQuoteContext(pool, quoteId) {
  const [quotes] = await pool.query(
    `SELECT q.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM quotes q
     LEFT JOIN customers c ON q.customer_id = c.id
     WHERE q.id = ?`,
    [quoteId]
  );
  if (!quotes.length) return null;
  const q = quotes[0];
  const itemCols = await repo.quoteItemColumns(pool);
  const ob = repo.quoteItemsOrderByClause(itemCols);
  const [items] = await pool.query(
    `SELECT * FROM quote_items WHERE quote_id = ? ORDER BY ${ob}`,
    [quoteId]
  );
  return {
    quote: q,
    items: items.map(mapItemRow),
  };
}

export async function saveQuoteFull(pool, quoteId, body, userId, { snapshotPrevious = true } = {}) {
  const prev = snapshotPrevious ? await loadQuoteContext(pool, quoteId) : null;

  const items = Array.isArray(body.items) ? body.items.map((i) => calc.normalizeItem(i)) : [];
  const subtotal = body.subtotal != null ? Number(body.subtotal) : calc.sumItems(items);
  const discountType = body.discount_type || 'percentage';
  const discountValue = Number(body.discount_value) || 0;
  const taxTotal = Number(body.tax_total) || 0;
  const total = computeTotal(subtotal, discountType, discountValue, taxTotal);

  const cols = await repo.quoteColumns(pool);
  const updates = [];
  const vals = [];

  const set = (col, val) => {
    if (val === undefined) return;
    if (cols.has(col)) {
      updates.push(`\`${col}\` = ?`);
      vals.push(val);
    }
  };

  if (body.customer_id !== undefined) set('customer_id', body.customer_id);
  if (body.lead_id !== undefined) set('lead_id', body.lead_id);
  if (body.assigned_to !== undefined) set('assigned_to', body.assigned_to);
  if (body.service_type !== undefined) set('service_type', body.service_type);
  if (body.status !== undefined) set('status', body.status);
  if (body.expiration_date !== undefined) set('expiration_date', body.expiration_date);
  if (body.issue_date !== undefined) set('issue_date', body.issue_date);
  if (body.notes !== undefined) set('notes', body.notes);
  if (body.internal_notes !== undefined) set('internal_notes', body.internal_notes);
  if (body.terms_conditions !== undefined) set('terms_conditions', body.terms_conditions);
  set('subtotal', subtotal);
  set('discount_type', discountType);
  set('discount_value', discountValue);
  set('tax_total', taxTotal);
  set('total_amount', total);
  if (body.labor_amount !== undefined) set('labor_amount', body.labor_amount);
  if (body.materials_amount !== undefined) set('materials_amount', body.materials_amount);

  if (updates.length) {
    vals.push(quoteId);
    await pool.execute(`UPDATE quotes SET ${updates.join(', ')} WHERE id = ?`, vals);
  }

  await repo.replaceQuoteItems(pool, quoteId, items);

  if (prev && userId) {
    try {
      await repo.insertQuoteSnapshot(pool, quoteId, prev, userId);
    } catch (e) {
      const msg = String(e?.sqlMessage || e?.message || '');
      if (e?.code === 'ER_NO_SUCH_TABLE' && msg.includes('quote_snapshots')) {
        console.warn('[quotes] quote_snapshots ausente — ignorar snapshot. Rode migrate:quotes-module.');
      } else {
        throw e;
      }
    }
  }

  return loadQuoteContext(pool, quoteId);
}

function computeTotal(subtotal, discountType, discountValue, taxTotal) {
  return calc.computeTotal(subtotal, discountType, discountValue, taxTotal);
}

export async function createQuoteFull(pool, body, userId) {
  const [last] = await pool.query(
    "SELECT quote_number FROM quotes WHERE quote_number IS NOT NULL ORDER BY id DESC LIMIT 1"
  );
  let quoteNumber = `Q-${new Date().getFullYear()}-0001`;
  if (last.length > 0 && last[0].quote_number) {
    const m = String(last[0].quote_number).match(/Q-(\d{4})-(\d+)/);
    if (m) {
      const year = new Date().getFullYear();
      const num = parseInt(m[2], 10) + 1;
      quoteNumber = `Q-${year}-${String(num).padStart(4, '0')}`;
    }
  }

  const items = Array.isArray(body.items) ? body.items.map((i) => calc.normalizeItem(i)) : [];
  const subtotal = body.subtotal != null ? Number(body.subtotal) : calc.sumItems(items);
  const discountType = body.discount_type || 'percentage';
  const discountValue = Number(body.discount_value) || 0;
  const taxTotal = Number(body.tax_total) || 0;
  const total = computeTotal(subtotal, discountType, discountValue, taxTotal);
  const token = repo.newPublicToken();

  const cols = await repo.quoteColumns(pool);
  const fields = [
    'lead_id',
    'customer_id',
    'project_id',
    'total_amount',
    'labor_amount',
    'materials_amount',
    'status',
    'quote_number',
    'expiration_date',
    'notes',
    'created_by',
    'subtotal',
    'discount_type',
    'discount_value',
    'tax_total',
    'terms_conditions',
    'service_type',
    'assigned_to',
    'public_token',
  ];
  const present = fields.filter((f) => cols.has(f));
  const placeholders = present.map(() => '?').join(', ');
  const values = present.map((f) => {
    switch (f) {
      case 'lead_id':
        return body.lead_id ?? null;
      case 'customer_id':
        return body.customer_id ?? null;
      case 'project_id':
        return body.project_id ?? null;
      case 'total_amount':
        return total;
      case 'labor_amount':
        return body.labor_amount ?? 0;
      case 'materials_amount':
        return body.materials_amount ?? 0;
      case 'status':
        return body.status || 'draft';
      case 'quote_number':
        return quoteNumber;
      case 'expiration_date':
        return body.expiration_date || null;
      case 'notes':
        return body.notes || null;
      case 'created_by':
        return userId || null;
      case 'subtotal':
        return subtotal;
      case 'discount_type':
        return discountType;
      case 'discount_value':
        return discountValue;
      case 'tax_total':
        return taxTotal;
      case 'terms_conditions':
        return body.terms_conditions || null;
      case 'service_type':
        return body.service_type || null;
      case 'assigned_to':
        return body.assigned_to ?? null;
      case 'public_token':
        return cols.has('public_token') ? token : null;
      default:
        return null;
    }
  });

  const [ins] = await pool.execute(
    `INSERT INTO quotes (${present.map((f) => `\`${f}\``).join(', ')}) VALUES (${placeholders})`,
    values
  );
  const quoteId = ins.insertId;

  if (items.length) {
    await repo.replaceQuoteItems(pool, quoteId, items);
  }

  if (!cols.has('public_token')) {
    /* old schema */
  }

  return { id: quoteId, quote_number: quoteNumber, public_token: token };
}

export async function duplicateQuote(pool, quoteId, userId) {
  const ctx = await loadQuoteContext(pool, quoteId);
  if (!ctx) return null;
  const q = ctx.quote;
  const body = {
    lead_id: q.lead_id,
    customer_id: q.customer_id,
    project_id: q.project_id,
    status: 'draft',
    expiration_date: null,
    notes: q.notes,
    internal_notes: q.internal_notes,
    terms_conditions: q.terms_conditions,
    service_type: q.service_type,
    assigned_to: q.assigned_to,
    discount_type: q.discount_type,
    discount_value: q.discount_value,
    tax_total: q.tax_total,
    subtotal: q.subtotal,
    items: ctx.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      rate: it.rate,
      unit_type: it.unit_type,
      notes: it.notes,
      service_catalog_id: it.service_catalog_id,
      type: it.type,
    })),
  };
  const created = await createQuoteFull(pool, body, userId);
  return loadQuoteContext(pool, created.id);
}

export async function generatePdfAndStore(pool, quoteId) {
  const ctx = await loadQuoteContext(pool, quoteId);
  if (!ctx) return { ok: false, error: 'Quote not found' };
  const pdfBuf = await buildQuotePdfBuffer({
    quote: ctx.quote,
    items: ctx.items,
    customer: {
      name: ctx.quote.customer_name,
      email: ctx.quote.customer_email,
      phone: ctx.quote.customer_phone,
    },
  });

  const [colRows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'invoice_pdf'`
  );
  if (colRows.length) {
    await pool.execute('UPDATE quotes SET invoice_pdf = ? WHERE id = ?', [pdfBuf, quoteId]);
  }

  return { ok: true, buffer: pdfBuf };
}

export async function mailQuote(pool, quoteId, EmailOpts = {}) {
  const ctx = await loadQuoteContext(pool, quoteId);
  if (!ctx) return { ok: false, error: 'Quote not found' };
  const email = EmailOpts.to || ctx.quote.customer_email;
  let pdfBuf = EmailOpts.pdfBuffer;
  if (!pdfBuf) {
    const gen = await generatePdfAndStore(pool, quoteId);
    pdfBuf = gen.buffer;
  }
  const base =
    process.env.PUBLIC_CRM_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  const token = ctx.quote.public_token;
  const publicUrl =
    token && base ? `${base.replace(/\/$/, '')}/quote-public.html?t=${encodeURIComponent(token)}` : '';

  const result = await sendQuoteEmail({
    to: email,
    subject: EmailOpts.subject || `Quote ${ctx.quote.quote_number || quoteId} — Senior Floors`,
    html: EmailOpts.html,
    pdfBuffer: pdfBuf,
    filename: `Senior-Floors-${ctx.quote.quote_number || quoteId}.pdf`,
    publicUrl,
  });

  if (result.ok) {
    const cols = await repo.quoteColumns(pool);
    if (cols.has('email_sent_at')) {
      await pool.execute(
        `UPDATE quotes SET email_sent_at = NOW(),
         status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END
         WHERE id = ?`,
        [quoteId]
      );
    } else {
      await pool.execute(
        `UPDATE quotes SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
         sent_at = COALESCE(sent_at, NOW()) WHERE id = ?`,
        [quoteId]
      );
    }
  }

  return result;
}

export async function getByPublicToken(pool, token) {
  const [quotes] = await pool.query(
    `SELECT q.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM quotes q
     LEFT JOIN customers c ON q.customer_id = c.id
     WHERE q.public_token = ?`,
    [token]
  );
  if (!quotes.length) return null;
  const q = quotes[0];
  const itemCols = await repo.quoteItemColumns(pool);
  const ob = repo.quoteItemsOrderByClause(itemCols);
  const [items] = await pool.query(
    `SELECT * FROM quote_items WHERE quote_id = ? ORDER BY ${ob}`,
    [q.id]
  );
  return { quote: q, items: items.map(mapItemRow) };
}

export async function markQuoteViewed(pool, token) {
  const ctx = await getByPublicToken(pool, token);
  if (!ctx) return null;
  const id = ctx.quote.id;
  const st = String(ctx.quote.status || '').toLowerCase();
  await pool.execute('UPDATE quotes SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = ?', [id]);
  if (st === 'sent') {
    await pool.execute('UPDATE quotes SET status = ? WHERE id = ? AND status = ?', ['viewed', id, 'sent']);
  }
  return getByPublicToken(pool, token);
}

export async function approvePublicQuote(pool, token) {
  const ctx = await getByPublicToken(pool, token);
  if (!ctx) return null;
  const id = ctx.quote.id;
  await pool.execute(
    'UPDATE quotes SET status = ?, approved_at = COALESCE(approved_at, NOW()) WHERE id = ?',
    ['approved', id]
  );
  return getByPublicToken(pool, token);
}
