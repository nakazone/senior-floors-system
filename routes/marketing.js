/**
 * Marketing analytics: metrics, ad spend CRUD, CSV export.
 */
import { getDBConnection, isDatabaseConfigured } from '../config/db.js';

function parseDate(s, fallback) {
  if (!s || typeof s !== 'string') return fallback;
  const d = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return fallback;
  return d;
}

async function tableExists(pool, name) {
  const [t] = await pool.query("SHOW TABLES LIKE ?", [name]);
  return t && t.length > 0;
}

/** GET /api/marketing/metrics */
export async function getMarketingMetrics(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const end = parseDate(req.query.end_date, new Date().toISOString().slice(0, 10));
  const start = parseDate(req.query.start_date, end);
  const utmCampaign = (req.query.utm_campaign || '').trim() || null;
  const platform = (req.query.marketing_platform || req.query.platform || '').trim() || null;
  const sourceFilter = (req.query.source || '').trim() || null;

  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database unavailable' });

    const leadFilters = ['l.created_at >= ?', 'l.created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
    const leadParams = [start, end];
    if (utmCampaign) {
      leadFilters.push('l.utm_campaign = ?');
      leadParams.push(utmCampaign);
    }
    if (platform) {
      leadFilters.push('l.marketing_platform = ?');
      leadParams.push(platform);
    }
    if (sourceFilter) {
      leadFilters.push('l.source = ?');
      leadParams.push(sourceFilter);
    }
    const leadWhere = leadFilters.join(' AND ');

    const attrFilters = [];
    const attrParams = [];
    if (utmCampaign) {
      attrFilters.push('l.utm_campaign = ?');
      attrParams.push(utmCampaign);
    }
    if (platform) {
      attrFilters.push('l.marketing_platform = ?');
      attrParams.push(platform);
    }
    if (sourceFilter) {
      attrFilters.push('l.source = ?');
      attrParams.push(sourceFilter);
    }
    const attrWhere = attrFilters.length ? attrFilters.join(' AND ') : null;

    const [[{ total_leads }]] = await pool.query(
      `SELECT COUNT(*) AS total_leads FROM leads l WHERE ${leadWhere}`,
      leadParams
    );

    const spendWhere = ['spend_date >= ?', 'spend_date <= ?'];
    const spendParams = [start, end];
    if (platform) {
      spendWhere.push('platform = ?');
      spendParams.push(platform);
    }
    if (utmCampaign) {
      spendWhere.push('(utm_campaign = ? OR campaign_name = ?)');
      spendParams.push(utmCampaign, utmCampaign);
    }
    let total_spend = 0;
    if (await tableExists(pool, 'ad_spend')) {
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(spend), 0) AS s FROM ad_spend WHERE ${spendWhere.join(' AND ')}`,
        spendParams
      );
      total_spend = Number(row.s) || 0;
    }

    const quoteWhere = ['q.created_at >= ?', 'q.created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
    const quoteParams = [start, end];
    if (attrWhere) {
      quoteWhere.push(`q.lead_id IN (SELECT l.id FROM leads l WHERE ${attrWhere})`);
      quoteParams.push(...attrParams);
    }
    const [[{ total_quotes }]] = await pool.query(
      `SELECT COUNT(*) AS total_quotes FROM quotes q WHERE ${quoteWhere.join(' AND ')}`,
      quoteParams
    );

    const [[{ quotes_sent }]] = await pool.query(
      `SELECT COUNT(*) AS quotes_sent FROM quotes q WHERE ${quoteWhere.join(' AND ')} AND q.status IN ('sent','approved','accepted')`,
      quoteParams
    );

    let dealWhere = ['c.created_at >= ?', 'c.created_at < DATE_ADD(?, INTERVAL 1 DAY)', 'c.closed_amount > 0'];
    const dealParams = [start, end];
    if (attrWhere) {
      dealWhere.push(`c.lead_id IN (SELECT l.id FROM leads l WHERE ${attrWhere})`);
      dealParams.push(...attrParams);
    }
    let total_deals = 0;
    let total_revenue = 0;
    if (await tableExists(pool, 'contracts')) {
      const [[d]] = await pool.query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(c.closed_amount), 0) AS rev FROM contracts c WHERE ${dealWhere.join(' AND ')}`,
        dealParams
      );
      total_deals = Number(d.n) || 0;
      total_revenue = Number(d.rev) || 0;
    }

    const leads = Number(total_leads) || 0;
    const cpl = leads > 0 && total_spend > 0 ? total_spend / leads : null;
    const cac = total_deals > 0 && total_spend > 0 ? total_spend / total_deals : null;
    const roi = total_spend > 0 ? total_revenue / total_spend : null;
    const quote_conv = total_quotes > 0 && leads > 0 ? total_quotes / leads : null;
    const lead_close = leads > 0 && total_deals > 0 ? total_deals / leads : null;
    const rpl = leads > 0 && total_revenue > 0 ? total_revenue / leads : null;
    const avg_ticket = total_deals > 0 ? total_revenue / total_deals : null;

    const funnelSlugs = [
      'lead_received',
      'contact_made',
      'qualified',
      'proposal_sent',
      'negotiation',
      'closed_won',
      'closed_lost',
    ];
    const funnel = [];
    for (const slug of funnelSlugs) {
      const f = ['l.created_at >= ?', 'l.created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
      const p = [start, end];
      if (utmCampaign) {
        f.push('l.utm_campaign = ?');
        p.push(utmCampaign);
      }
      if (platform) {
        f.push('l.marketing_platform = ?');
        p.push(platform);
      }
      if (sourceFilter) {
        f.push('l.source = ?');
        p.push(sourceFilter);
      }
      f.push('(l.status = ? OR ps.slug = ?)');
      p.push(slug, slug);
      const [[{ n }]] = await pool.query(
        `SELECT COUNT(*) AS n FROM leads l
         LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
         WHERE ${f.join(' AND ')}`,
        p
      );
      funnel.push({ stage: slug, count: Number(n) || 0 });
    }

    let leads_over_time = [];
    const [lot] = await pool.query(
      `SELECT DATE(l.created_at) AS d, COUNT(*) AS c FROM leads l WHERE ${leadWhere} GROUP BY DATE(l.created_at) ORDER BY d`,
      leadParams
    );
    leads_over_time = lot;

    let revenue_over_time = [];
    if (await tableExists(pool, 'contracts')) {
      const revPh = ['c.created_at >= ?', 'c.created_at < DATE_ADD(?, INTERVAL 1 DAY)', 'c.closed_amount > 0'];
      const revPa = [start, end];
      if (attrWhere) {
        revPh.push(`c.lead_id IN (SELECT l.id FROM leads l WHERE ${attrWhere})`);
        revPa.push(...attrParams);
      }
      const [rot] = await pool.query(
        `SELECT DATE(c.created_at) AS d, COALESCE(SUM(c.closed_amount), 0) AS rev
         FROM contracts c WHERE ${revPh.join(' AND ')}
         GROUP BY DATE(c.created_at) ORDER BY d`,
        revPa
      );
      revenue_over_time = rot;
    }

    let revenue_by_campaign = [];
    const colSet = await pool.query("SHOW COLUMNS FROM leads LIKE 'utm_campaign'");
    if (colSet[0].length && await tableExists(pool, 'contracts')) {
      const [rbc] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(l.utm_campaign), ''), '(sem campanha)') AS campaign,
                COALESCE(SUM(c.closed_amount), 0) AS revenue,
                COUNT(DISTINCT c.id) AS deals
         FROM contracts c
         INNER JOIN leads l ON c.lead_id = l.id
         WHERE c.created_at >= ? AND c.created_at < DATE_ADD(?, INTERVAL 1 DAY) AND c.closed_amount > 0
         GROUP BY campaign ORDER BY revenue DESC LIMIT 25`,
        [start, end]
      );
      revenue_by_campaign = rbc;
    }

    res.json({
      success: true,
      data: {
        period: { start, end },
        filters: { utm_campaign: utmCampaign, marketing_platform: platform, source: sourceFilter },
        kpis: {
          total_spend,
          total_leads: leads,
          total_quotes: Number(total_quotes) || 0,
          quotes_sent: Number(quotes_sent) || 0,
          total_deals,
          total_revenue,
          cpl,
          cac,
          roi,
          quote_conversion_rate: quote_conv,
          lead_to_close_rate: lead_close,
          revenue_per_lead: rpl,
          avg_deal_value: avg_ticket,
        },
        funnel,
        leads_over_time,
        revenue_over_time,
        revenue_by_campaign,
      },
    });
  } catch (e) {
    console.error('getMarketingMetrics', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

/** GET /api/marketing/ad-spend */
export async function listAdSpend(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const pool = await getDBConnection();
    if (!(await tableExists(pool, 'ad_spend'))) {
      return res.json({ success: true, data: [], total: 0 });
    }
    const start = parseDate(req.query.start_date, '1970-01-01');
    const end = parseDate(req.query.end_date, '2099-12-31');
    const [rows] = await pool.query(
      'SELECT * FROM ad_spend WHERE spend_date >= ? AND spend_date <= ? ORDER BY spend_date DESC, id DESC LIMIT 500',
      [start, end]
    );
    const [[{ total }]] = await pool.query(
      'SELECT COALESCE(SUM(spend),0) AS total FROM ad_spend WHERE spend_date >= ? AND spend_date <= ?',
      [start, end]
    );
    res.json({ success: true, data: rows, period_spend: Number(total) || 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** POST /api/marketing/ad-spend */
export async function createAdSpend(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const { platform, campaign_name, utm_campaign, spend, spend_date, notes } = req.body || {};
  if (!platform || !campaign_name || spend == null || !spend_date) {
    return res.status(400).json({ success: false, error: 'platform, campaign_name, spend, spend_date required' });
  }
  try {
    const pool = await getDBConnection();
    if (!(await tableExists(pool, 'ad_spend'))) {
      return res.status(400).json({
        success: false,
        error: 'Tabela ad_spend não existe. Rode: node database/migrate-marketing-analytics.js',
      });
    }
    const [r] = await pool.execute(
      `INSERT INTO ad_spend (platform, campaign_name, utm_campaign, spend, spend_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(platform).slice(0, 32),
        String(campaign_name).slice(0, 255),
        utm_campaign ? String(utm_campaign).slice(0, 255) : null,
        parseFloat(spend) || 0,
        String(spend_date).slice(0, 10),
        notes ? String(notes).slice(0, 500) : null,
      ]
    );
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** PUT /api/marketing/ad-spend/:id */
export async function updateAdSpend(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
  const b = req.body || {};
  const fields = [];
  const vals = [];
  for (const [k, col] of [
    ['platform', 'platform'],
    ['campaign_name', 'campaign_name'],
    ['utm_campaign', 'utm_campaign'],
    ['spend', 'spend'],
    ['spend_date', 'spend_date'],
    ['notes', 'notes'],
  ]) {
    if (b[k] !== undefined) {
      fields.push(`${col} = ?`);
      vals.push(b[k]);
    }
  }
  if (!fields.length) return res.status(400).json({ success: false, error: 'No fields' });
  vals.push(id);
  try {
    const pool = await getDBConnection();
    await pool.execute(`UPDATE ad_spend SET ${fields.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** DELETE /api/marketing/ad-spend/:id */
export async function deleteAdSpend(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const pool = await getDBConnection();
    await pool.execute('DELETE FROM ad_spend WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** GET /api/marketing/export/leads — CSV */
export async function exportLeadsCsv(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).end();
  const end = parseDate(req.query.end_date, new Date().toISOString().slice(0, 10));
  const start = parseDate(req.query.start_date, end);
  try {
    const pool = await getDBConnection();
    let rows;
    try {
      [rows] = await pool.query(
        `SELECT id, name, email, phone, zipcode, source, marketing_platform, utm_source, utm_medium, utm_campaign,
                utm_content, utm_term, utm_adset, utm_ad, status, created_at
         FROM leads WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY id`,
        [start, end]
      );
    } catch (_) {
      [rows] = await pool.query(
        `SELECT id, name, email, phone, zipcode, source, status, created_at
         FROM leads WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY id`,
        [start, end]
      );
    }
    const headers = rows.length ? Object.keys(rows[0]) : ['id', 'name', 'email', 'phone', 'zipcode', 'source', 'status', 'created_at'];
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => esc(row[h])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${start}-${end}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** GET /api/marketing/leads-not-contacted — created > 5 min ago, still lead_received */
export async function getLeadsNotContactedUrgent(req, res) {
  if (!isDatabaseConfigured()) return res.status(503).json({ success: false, error: 'Database not configured' });
  try {
    const pool = await getDBConnection();
    const [rows] = await pool.query(
      `SELECT l.id, l.name, l.email, l.phone, l.created_at, ps.slug AS stage_slug
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.created_at <= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
         AND (l.status = 'lead_received' OR ps.slug = 'lead_received' OR (l.status = 'new' AND (ps.slug IS NULL OR ps.slug = 'lead_received')))
       ORDER BY l.created_at ASC
       LIMIT 50`
    );
    res.json({ success: true, data: rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}
