import * as calc from './calculations.js';
import * as repo from './quoteRepository.js';
import { buildQuotePdfBuffer } from './quotePdf.js';
import { sendQuoteEmail } from './quoteMail.js';
import { summarizeQuoteProfit } from '../pricing/marginPricing.js';
import { ensureProjectForApprovedQuote } from './quoteProjectFromApproval.js';

/** Resumo no quote (PDF / listagem): tipos únicos por linha, ex. "Installation · Sand & Finishing". */
export function deriveQuoteServiceSummary(items) {
  const set = new Set();
  for (const it of items || []) {
    const t = String(it.service_type || '').trim();
    if (t) set.add(t);
  }
  return set.size ? [...set].sort().join(' · ') : null;
}

export function mapItemRow(dbRow) {
  if (!dbRow) return null;
  const quantity = Number(dbRow.quantity ?? dbRow.area_sqft) || 0;
  const rate = Number(dbRow.unit_price) || 0;
  const amount = Number(dbRow.total_price) || calc.lineAmount(quantity, rate);
  let nameRaw = dbRow.name != null && String(dbRow.name).trim() !== '' ? String(dbRow.name).trim() : '';
  let descRaw =
    dbRow.description != null && String(dbRow.description).trim() !== ''
      ? String(dbRow.description).trim()
      : '';
  if (!nameRaw && descRaw) {
    const ix = descRaw.indexOf('\n');
    if (ix >= 0) {
      nameRaw = descRaw.slice(0, ix).trim();
      descRaw = descRaw.slice(ix + 1).trim();
    } else {
      nameRaw = descRaw;
      descRaw = '';
    }
  }
  return {
    id: dbRow.id,
    quote_id: dbRow.quote_id,
    service_catalog_id: dbRow.service_catalog_id ?? null,
    name: nameRaw || null,
    description: descRaw || null,
    unit_type: dbRow.unit_type || 'sq_ft',
    quantity,
    rate,
    unit_price: rate,
    amount,
    total_price: amount,
    notes: dbRow.notes || null,
    service_type: dbRow.service_type || null,
    catalog_customer_notes: dbRow.catalog_customer_notes || null,
    item_type: dbRow.item_type || 'service',
    product_id: dbRow.product_id ?? null,
    cost_price: dbRow.cost_price != null ? Number(dbRow.cost_price) : null,
    markup_percentage: dbRow.markup_percentage != null ? Number(dbRow.markup_percentage) : null,
    sell_price: dbRow.sell_price != null ? Number(dbRow.sell_price) : null,
    type: dbRow.type || 'service',
    floor_type: dbRow.floor_type,
    sort_order: dbRow.sort_order ?? 0,
  };
}

function escapeHtmlEmail(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moneyEmail(n) {
  const x = Number(n) || 0;
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Mesma lógica de secções do PDF (Installation / Sand & Finishing / produtos). */
function lineSectionEmail(it) {
  if (String(it.item_type || '').toLowerCase() === 'product') return 'products';
  const st = String(it.service_type || '').trim();
  if (!st) return 'installation';
  const lower = st.toLowerCase();
  if (lower.includes('sand') || lower.includes('finishing')) return 'sand_finish';
  return 'installation';
}

const EMAIL_SECTIONS = [
  { key: 'installation', label: 'Installation' },
  { key: 'sand_finish', label: 'Sand & Finishing' },
  { key: 'products', label: 'Materials & products' },
];

function groupItemsForEmail(items) {
  const list = Array.isArray(items) ? items : [];
  const buckets = { installation: [], sand_finish: [], products: [] };
  for (const it of list) {
    const k = lineSectionEmail(it);
    if (buckets[k]) buckets[k].push(it);
    else buckets.installation.push(it);
  }
  return EMAIL_SECTIONS.filter((d) => buckets[d.key].length > 0).map((d) => ({
    label: d.label,
    items: buckets[d.key],
  }));
}

/**
 * HTML do e-mail: paleta e estrutura alinhadas ao PDF; total em destaque.
 */
function buildQuoteEmailHtml(quote, items, publicUrl) {
  const navy = '#1a2036';
  const sand = '#d6b598';
  const sandDark = '#c4a588';
  const muted = '#4a5568';
  const clientName = escapeHtmlEmail(quote.customer_name || 'Client');
  const qn = escapeHtmlEmail(quote.quote_number || quote.id || '');
  const sub = Number(quote.subtotal) || 0;
  const tax = Number(quote.tax_total) || 0;
  const total = Number(quote.total_amount) || 0;
  const totalStr = moneyEmail(total);
  const discType = quote.discount_type === 'fixed' ? 'fixed' : 'percentage';
  const discVal = Number(quote.discount_value) || 0;
  const discAmt = calc.discountAmount(sub, discType, discVal);
  const discLabel =
    discType === 'fixed' ? 'Discount ($)' : `Discount (${discVal}%)`;

  const sections = groupItemsForEmail(items);
  let linesBody = '';
  for (const sec of sections) {
    linesBody += `<tr><td colspan="4" style="background-color:#efe8df;padding:10px 12px;font-size:11px;font-weight:bold;color:${navy};letter-spacing:0.04em;border-left:4px solid ${sandDark};">${escapeHtmlEmail(sec.label)}</td></tr>
<tr style="background-color:rgba(26,32,54,0.06);font-size:10px;font-weight:bold;color:${navy};">
<td style="padding:8px 12px;">Description</td>
<td style="padding:8px 6px;text-align:right;width:72px;">Qty</td>
<td style="padding:8px 6px;text-align:right;width:88px;">Rate</td>
<td style="padding:8px 12px;text-align:right;width:100px;">Amount</td>
</tr>`;
    for (const it of sec.items) {
      const nm = String(it.name || '').trim();
      const dc = String(it.description || '').trim();
      const title = escapeHtmlEmail(nm || dc || 'Item');
      const subd =
        nm && dc && dc !== nm
          ? `<div style="margin-top:4px;font-size:12px;color:${muted};line-height:1.45;">${escapeHtmlEmail(dc).replace(/\n/g, '<br/>')}</div>`
          : '';
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.rate ?? it.unit_price) || 0;
      const amt = moneyEmail(it.amount ?? it.total_price);
      const ut = it.unit_type ? String(it.unit_type).replace(/_/g, ' ') : 'sq ft';
      linesBody += `<tr>
<td style="padding:12px;border-bottom:1px solid #e2e8f0;vertical-align:top;"><strong style="color:${navy};font-size:14px;">${title}</strong>${subd}</td>
<td style="padding:12px 6px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;color:${navy};white-space:nowrap;">${qty} ${escapeHtmlEmail(ut)}</td>
<td style="padding:12px 6px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;color:${navy};">${moneyEmail(rate)}</td>
<td style="padding:12px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;font-weight:bold;color:${navy};">${amt}</td>
</tr>`;
    }
  }
  if (!linesBody) {
    linesBody = `<tr><td colspan="4" style="padding:16px;color:${muted};">No line items.</td></tr>`;
  }

  const link =
    publicUrl && /^https?:\/\//i.test(publicUrl)
      ? `<p style="margin:24px 0 0;font-size:14px;color:${navy};"><a href="${escapeHtmlEmail(publicUrl)}" style="color:${sandDark};font-weight:bold;">View or approve this quote online</a></p><p style="margin:4px 0 0;font-size:12px;color:${muted};word-break:break-all;">${escapeHtmlEmail(publicUrl)}</p>`
      : '';

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#f7f8fc;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8fc;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(26,32,54,0.08);font-family:Inter,Segoe UI,Arial,sans-serif;color:${navy};">
<tr><td style="height:5px;background-color:${sand};line-height:5px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:24px 24px 8px;font-size:22px;font-weight:bold;letter-spacing:-0.02em;">Senior Floors</td></tr>
<tr><td style="padding:0 24px 16px;font-size:13px;color:#2a3150;">Hardwood · LVP · Refinishing · Denver Metro</td></tr>
<tr><td style="padding:0 24px 20px;border-bottom:1px solid #e2e8f0;">
<p style="margin:0 0 6px;font-size:12px;color:${sandDark};font-weight:bold;text-transform:uppercase;letter-spacing:0.06em;">Quote</p>
<p style="margin:0;font-size:18px;font-weight:bold;color:${navy};">#${qn}</p>
<p style="margin:8px 0 0;font-size:14px;color:${navy};">Hello ${clientName},</p>
<p style="margin:8px 0 0;font-size:14px;line-height:1.55;color:${muted};">Below is the same breakdown as in your attached PDF. Your <strong style="color:${navy};">quote total is ${totalStr}</strong>.</p>
</td></tr>
<tr><td style="padding:20px 24px 8px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${linesBody}</table>
</td></tr>
<tr><td style="padding:8px 24px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:${muted};">
<tr><td style="padding:6px 0;">Subtotal</td><td style="padding:6px 0;text-align:right;color:${navy};">${moneyEmail(sub)}</td></tr>
<tr><td style="padding:6px 0;">Tax</td><td style="padding:6px 0;text-align:right;color:${navy};">${moneyEmail(tax)}</td></tr>
<tr><td style="padding:6px 0;">${escapeHtmlEmail(discLabel)}</td><td style="padding:6px 0;text-align:right;color:${navy};">${moneyEmail(discAmt)}</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-collapse:collapse;background-color:${navy};border-radius:4px;">
<tr>
<td style="padding:14px 16px;font-size:12px;font-weight:bold;color:#ffffff;text-transform:uppercase;letter-spacing:0.05em;">Total</td>
<td style="padding:14px 16px;text-align:right;font-size:22px;font-weight:bold;color:${sand};">${totalStr}</td>
</tr>
</table>
${link}
<p style="margin:24px 0 0;font-size:13px;color:${muted};">— Senior Floors · (720) 751-9813 · contact@senior-floors.com</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
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
  const mapped = items.map(mapItemRow);
  return {
    quote: q,
    items: mapped,
    profit_summary: summarizeQuoteProfit(mapped),
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
  if (Array.isArray(body.items)) {
    const summary = deriveQuoteServiceSummary(items);
    set('service_type', summary);
  } else if (body.service_type !== undefined) {
    set('service_type', body.service_type);
  }
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

  const prevSt = prev ? String(prev.quote?.status || '').toLowerCase() : null;
  const newStFromBody = body.status !== undefined ? String(body.status).toLowerCase() : null;
  const becameApproved =
    newStFromBody &&
    ['approved', 'accepted'].includes(newStFromBody) &&
    (!prevSt || !['approved', 'accepted'].includes(prevSt));

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

  if (becameApproved) {
    try {
      await ensureProjectForApprovedQuote(pool, quoteId);
    } catch (e) {
      console.error('[quotes] saveQuoteFull: project auto-create failed', e);
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
        return deriveQuoteServiceSummary(items) ?? body.service_type ?? null;
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

  const stNew = String(body.status || 'draft').toLowerCase();
  if (['approved', 'accepted'].includes(stNew)) {
    try {
      await ensureProjectForApprovedQuote(pool, quoteId);
    } catch (e) {
      console.error('[quotes] createQuoteFull: project auto-create failed', e);
    }
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
      name: it.name,
      description: it.description,
      quantity: it.quantity,
      rate: it.rate,
      unit_type: it.unit_type,
      notes: it.notes,
      service_catalog_id: it.service_catalog_id,
      service_type: it.service_type,
      catalog_customer_notes: it.catalog_customer_notes,
      item_type: it.item_type,
      product_id: it.product_id,
      cost_price: it.cost_price,
      markup_percentage: it.markup_percentage,
      sell_price: it.sell_price,
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
  const rawTo = EmailOpts.to != null ? String(EmailOpts.to).trim() : '';
  const custEmail =
    ctx.quote.customer_email != null ? String(ctx.quote.customer_email).trim() : '';
  const email = rawTo || custEmail;
  if (!email) {
    return {
      ok: false,
      error:
        'E-mail em falta: indique o destinatário no envio ou associe um cliente com e-mail a este orçamento.',
    };
  }
  let pdfBuf = EmailOpts.pdfBuffer;
  if (!pdfBuf) {
    const gen = await generatePdfAndStore(pool, quoteId);
    if (!gen.ok || !gen.buffer) {
      return { ok: false, error: gen.error || 'Não foi possível gerar o PDF do orçamento.' };
    }
    pdfBuf = gen.buffer;
  }
  const base =
    process.env.PUBLIC_CRM_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  const token = ctx.quote.public_token;
  const publicUrl =
    token && base ? `${base.replace(/\/$/, '')}/quote-public.html?t=${encodeURIComponent(token)}` : '';

  const useCustomHtml =
    EmailOpts.html != null && String(EmailOpts.html).trim() !== '';
  const result = await sendQuoteEmail({
    to: email,
    subject: EmailOpts.subject || `Quote ${ctx.quote.quote_number || quoteId} — Senior Floors`,
    html: useCustomHtml ? EmailOpts.html : buildQuoteEmailHtml(ctx.quote, ctx.items, publicUrl),
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
  try {
    await ensureProjectForApprovedQuote(pool, id);
  } catch (e) {
    console.error('[quotes] approvePublicQuote: project auto-create failed', e);
  }
  return getByPublicToken(pool, token);
}
