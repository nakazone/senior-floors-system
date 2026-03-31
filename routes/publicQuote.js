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
        items: ctx.items,
      },
    });
  } catch (e) {
    console.error('getPublicQuote:', e);
    res.status(500).json({ success: false, error: e.message });
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
        items: ctx.items,
      },
    });
  } catch (e) {
    console.error('postApproveQuote:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}
