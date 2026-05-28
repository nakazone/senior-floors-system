import * as calc from './calculations.js';
import * as repo from './quoteRepository.js';
import { buildQuotePdfBuffer } from './quotePdf.js';
import { sendQuoteEmail } from './quoteMail.js';
import { buildPublicQuoteUrl, getPublicCrmBaseUrl } from '../../lib/publicQuoteUrl.js';
import { summarizeQuoteProfit } from '../pricing/marginPricing.js';
import { ensureProjectForApprovedQuote } from './quoteProjectFromApproval.js';
import { applyQuoteLineRevenueToProject } from '../../lib/syncProjectRevenueFromQuote.js';

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

/** Mesma lógica de secções do PDF (Installation / Sand & Finishing / Supply / produtos). */
function lineSectionEmail(it) {
  if (String(it.item_type || '').toLowerCase() === 'product') return 'products';
  const st = String(it.service_type || '').trim();
  if (!st) return 'installation';
  const lower = st.toLowerCase();
  if (lower === 'supply') return 'supply';
  if (lower.includes('sand') || lower.includes('finishing')) return 'sand_finish';
  return 'installation';
}

const EMAIL_SECTIONS = [
  { key: 'installation', label: 'Installation' },
  { key: 'sand_finish', label: 'Sand & Finishing' },
  { key: 'supply', label: 'Supply' },
  { key: 'products', label: 'Materials & products' },
];

function groupItemsForEmail(items) {
  const list = Array.isArray(items) ? items : [];
  const buckets = { installation: [], sand_finish: [], supply: [], products: [] };
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
 * E-mail só com link seguro — sem linhas, totais nem PDF anexo (cliente abre a página pública).
 */
export function buildQuoteAccessEmailHtml(quote, publicUrl) {
  const navy = '#1a2036';
  const sand = '#d6b598';
  const sandDark = '#c4a588';
  const muted = '#4a5568';
  const clientName = escapeHtmlEmail(quote.customer_name || 'Client');
  const qn = escapeHtmlEmail(quote.quote_number || quote.id || '');
  const safeUrl = publicUrl && /^https?:\/\//i.test(publicUrl) ? publicUrl : '';
  const exp =
    quote.expiration_date != null
      ? String(quote.expiration_date).slice(0, 10)
      : '';
  const expLine = exp
    ? `<p style="margin:16px 0 0;font-size:13px;color:${muted};">Valid until <strong style="color:${navy};">${escapeHtmlEmail(exp)}</strong></p>`
    : '';

  const cta = safeUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;border-collapse:separate;">
<tr><td align="center" style="border-radius:8px;background-color:${sand};">
<a href="${escapeHtmlEmail(safeUrl)}" style="display:inline-block;padding:16px 32px;font-size:16px;font-weight:bold;color:${navy};text-decoration:none;letter-spacing:0.02em;">View your quote</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:12px;color:${muted};line-height:1.5;text-align:center;">Or copy this link into your browser:</p>
<p style="margin:6px 0 0;font-size:12px;color:${sandDark};word-break:break-all;text-align:center;"><a href="${escapeHtmlEmail(safeUrl)}" style="color:${sandDark};">${escapeHtmlEmail(safeUrl)}</a></p>`
    : `<p style="margin:20px 0 0;font-size:14px;color:#b45309;">Online link unavailable — please contact Senior Floors.</p>`;

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#f7f8fc;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8fc;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-collapse:collapse;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(26,32,54,0.1);font-family:Inter,Segoe UI,Arial,sans-serif;color:${navy};">
<tr><td style="height:5px;background-color:${sand};line-height:5px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 12px;text-align:center;">
<p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:-0.02em;">Senior Floors</p>
<p style="margin:6px 0 0;font-size:12px;color:#2a3150;">Hardwood · LVP · Refinishing · Denver Metro</p>
</td></tr>
<tr><td style="padding:8px 28px 28px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="margin:0 0 4px;font-size:11px;color:${sandDark};font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;">Your quote</p>
<p style="margin:0;font-size:20px;font-weight:bold;color:${navy};">#${qn}</p>
<p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:${navy};">Hello ${clientName},</p>
<p style="margin:12px 0 0;font-size:14px;line-height:1.65;color:${muted};max-width:420px;margin-left:auto;margin-right:auto;">Your quote is ready. For security, the full details and PDF are <strong style="color:${navy};">only available through the button below</strong> — not in this email.</p>
${cta}
${expLine}
<p style="margin:28px 0 0;font-size:12px;color:${muted};line-height:1.5;">Questions? Reply to this email or call (720) 751-9813.</p>
<p style="margin:8px 0 0;font-size:12px;color:${muted};">— Senior Floors</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

/** @deprecated Use buildQuoteAccessEmailHtml — mantido para compatibilidade interna. */
function buildQuoteEmailHtml(quote, items, publicUrl) {
  return buildQuoteAccessEmailHtml(quote, publicUrl);
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

  const out = await loadQuoteContext(pool, quoteId);
  const pid = out.quote?.project_id != null ? parseInt(String(out.quote.project_id), 10) : null;
  if (pid && pid > 0) {
    try {
      await applyQuoteLineRevenueToProject(pool, pid, quoteId);
    } catch (e) {
      console.warn('[quotes] saveQuoteFull: sync project revenue from quote lines:', e.message);
    }
  }
  return out;
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

  try {
    const [qref] = await pool.query('SELECT project_id FROM quotes WHERE id = ?', [quoteId]);
    const pid = qref[0]?.project_id != null ? parseInt(String(qref[0].project_id), 10) : null;
    if (pid && pid > 0) {
      await applyQuoteLineRevenueToProject(pool, pid, quoteId);
    }
  } catch (e) {
    console.warn('[quotes] createQuoteFull: sync project revenue:', e.message);
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

export async function ensureQuotePublicToken(pool, quoteId) {
  const cols = await repo.quoteColumns(pool);
  if (!cols.has('public_token')) return null;
  const [rows] = await pool.query('SELECT public_token FROM quotes WHERE id = ? LIMIT 1', [quoteId]);
  let token = rows[0]?.public_token;
  if (token != null) token = String(token).trim();
  if (token && token.length >= 16) return token;
  token = repo.newPublicToken();
  await pool.execute('UPDATE quotes SET public_token = ? WHERE id = ?', [token, quoteId]);
  return token;
}

export async function mailQuote(pool, quoteId, EmailOpts = {}) {
  await ensureQuotePublicToken(pool, quoteId);
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
  const gen = await generatePdfAndStore(pool, quoteId);
  if (!gen.ok) {
    return { ok: false, error: gen.error || 'Não foi possível gerar o PDF do orçamento.' };
  }
  const base = getPublicCrmBaseUrl();
  const token = ctx.quote.public_token;
  const publicUrl =
    buildPublicQuoteUrl(ctx.quote.quote_number, base) ||
    (token && base ? `${base}/quote-public.html?t=${encodeURIComponent(token)}` : '');

  if (!publicUrl) {
    return {
      ok: false,
      error:
        'Link público indisponível. Defina PUBLIC_CRM_URL no Railway (ex.: https://app.senior-floors.com).',
    };
  }

  const useCustomHtml =
    EmailOpts.html != null && String(EmailOpts.html).trim() !== '';
  const attachPdf = EmailOpts.attachPdf === true;
  const result = await sendQuoteEmail({
    to: email,
    subject: EmailOpts.subject || `Quote ${ctx.quote.quote_number || quoteId} — Senior Floors`,
    html: useCustomHtml ? EmailOpts.html : buildQuoteAccessEmailHtml(ctx.quote, publicUrl),
    pdfBuffer: attachPdf ? gen.buffer : null,
    filename: `Senior-Floors-${ctx.quote.quote_number || quoteId}.pdf`,
    publicUrl,
  });

  let emailSentAt = null;
  if (result.ok) {
    const cols = await repo.quoteColumns(pool);
    if (cols.has('email_sent_at')) {
      await pool.execute(
        `UPDATE quotes SET email_sent_at = NOW(),
         status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END
         WHERE id = ?`,
        [quoteId]
      );
      const [sentRows] = await pool.query(
        'SELECT email_sent_at FROM quotes WHERE id = ? LIMIT 1',
        [quoteId]
      );
      emailSentAt = sentRows[0]?.email_sent_at ?? null;
    } else {
      await pool.execute(
        `UPDATE quotes SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
         sent_at = COALESCE(sent_at, NOW()) WHERE id = ?`,
        [quoteId]
      );
    }
  }

  return emailSentAt != null ? { ...result, email_sent_at: emailSentAt } : result;
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

export async function getByQuoteNumber(pool, quoteNumber) {
  const qn = String(quoteNumber || '').trim();
  if (!qn) return null;
  const [quotes] = await pool.query(
    `SELECT q.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM quotes q
     LEFT JOIN customers c ON q.customer_id = c.id
     WHERE q.quote_number = ?`,
    [qn]
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

export async function markQuoteViewedByNumber(pool, quoteNumber) {
  const ctx = await getByQuoteNumber(pool, quoteNumber);
  if (!ctx) return null;
  const id = ctx.quote.id;
  const st = String(ctx.quote.status || '').toLowerCase();
  await pool.execute('UPDATE quotes SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = ?', [id]);
  if (st === 'sent') {
    await pool.execute('UPDATE quotes SET status = ? WHERE id = ? AND status = ?', ['viewed', id, 'sent']);
  }
  return getByQuoteNumber(pool, quoteNumber);
}

export async function markQuotePdfDownloadedByNumber(pool, quoteNumber) {
  const ctx = await getByQuoteNumber(pool, quoteNumber);
  if (!ctx) return null;
  const id = ctx.quote.id;
  const cols = await repo.quoteColumns(pool);
  if (cols.has('pdf_viewed_at')) {
    await pool.execute('UPDATE quotes SET pdf_viewed_at = COALESCE(pdf_viewed_at, NOW()) WHERE id = ?', [
      id,
    ]);
  }
  await pool.execute('UPDATE quotes SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = ?', [id]);
  const st = String(ctx.quote.status || '').toLowerCase();
  if (st === 'sent') {
    await pool.execute('UPDATE quotes SET status = ? WHERE id = ? AND status = ?', ['viewed', id, 'sent']);
  }
  return getByQuoteNumber(pool, quoteNumber);
}

export async function approvePublicQuoteByNumber(pool, quoteNumber) {
  const ctx = await getByQuoteNumber(pool, quoteNumber);
  if (!ctx) return null;
  const id = ctx.quote.id;
  await pool.execute(
    'UPDATE quotes SET status = ?, approved_at = COALESCE(approved_at, NOW()) WHERE id = ?',
    ['approved', id]
  );
  try {
    await ensureProjectForApprovedQuote(pool, id);
  } catch (e) {
    console.error('ensureProjectForApprovedQuote:', e);
  }
  return getByQuoteNumber(pool, quoteNumber);
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

/** Cliente descarregou o PDF na página pública (link rastreado). */
export async function markQuotePdfDownloaded(pool, token) {
  const ctx = await getByPublicToken(pool, token);
  if (!ctx) return null;
  const id = ctx.quote.id;
  const cols = await repo.quoteColumns(pool);
  if (cols.has('pdf_viewed_at')) {
    await pool.execute('UPDATE quotes SET pdf_viewed_at = COALESCE(pdf_viewed_at, NOW()) WHERE id = ?', [
      id,
    ]);
  }
  await pool.execute('UPDATE quotes SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = ?', [id]);
  const st = String(ctx.quote.status || '').toLowerCase();
  if (st === 'sent') {
    await pool.execute('UPDATE quotes SET status = ? WHERE id = ? AND status = ?', ['viewed', id, 'sent']);
  }
  return getByPublicToken(pool, token);
}

export async function getQuotePdfBufferForPublic(pool, quoteId) {
  const [colRows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'invoice_pdf'`
  );
  if (colRows.length) {
    const [rows] = await pool.query('SELECT invoice_pdf FROM quotes WHERE id = ? LIMIT 1', [quoteId]);
    const blob = rows[0]?.invoice_pdf;
    if (blob && Buffer.isBuffer(blob) && blob.length > 0) return blob;
    if (blob && typeof blob === 'object' && blob.length > 0) return Buffer.from(blob);
  }
  const gen = await generatePdfAndStore(pool, quoteId);
  if (!gen.ok || !gen.buffer) return null;
  return gen.buffer;
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
