/**
 * Public quote view (token) — no session.
 */
import { getDBConnection } from '../config/db.js';
import * as business from '../modules/quotes/quoteBusiness.js';

function sanitizeQuote(q) {
  if (!q) return q;
  const out = { ...q };
  delete out.invoice_pdf;
  delete out.internal_notes;
  delete out.created_by;
  return out;
}

function sanitizePublicItems(items) {
  return (items || []).map((it) => {
    const o = { ...it };
    delete o.cost_price;
    delete o.markup_percentage;
    delete o.product_id;
    delete o.item_type;
    return o;
  });
}

export async function getPublicQuote(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const ctx = await business.markQuoteViewed(pool, token);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });

    res.json({
      success: true,
      data: {
        quote: sanitizeQuote(ctx.quote),
        items: sanitizePublicItems(ctx.items),
      },
    });
  } catch (e) {
    console.error('getPublicQuote:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getPublicQuotePdf(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const ctx = await business.getByPublicToken(pool, token);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });

    await business.markQuotePdfDownloaded(pool, token);

    const pdfBuf = await business.getQuotePdfBufferForPublic(pool, ctx.quote.id);
    if (!pdfBuf || !pdfBuf.length) {
      return res.status(404).json({ success: false, error: 'PDF not available' });
    }

    const qn = ctx.quote.quote_number || ctx.quote.id;
    const filename = `Senior-Floors-Quote-${qn}.pdf`.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.send(pdfBuf);
  } catch (e) {
    console.error('getPublicQuotePdf:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
}

export async function postApproveQuote(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.approvePublicQuote(pool, token);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    res.json({
      success: true,
      data: {
        quote: sanitizeQuote(ctx.quote),
        items: sanitizePublicItems(ctx.items),
      },
    });
  } catch (e) {
    console.error('postApproveQuote:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}
