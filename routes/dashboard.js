/**
 * Dashboard API — métricas operacionais (pipeline, conversão, financeiro, alertas).
 * GET /api/dashboard/stats?period=today|week|month
 */
import { getDBConnection } from '../config/db.js';
import { isNoSuchTableError } from '../lib/mysqlSchemaErrors.js';

const PERIODS = new Set(['today', 'week', 'month']);

/** Condições SQL para coluna de timestamp `col` dentro do período */
function periodPredicate(col, period) {
  if (period === 'today') {
    return `DATE(${col}) = CURDATE()`;
  }
  if (period === 'week') {
    return `${col} >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
  }
  return `${col} >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`;
}

async function safeQuery(pool, sql, fallback = null) {
  try {
    const [rows] = await pool.query(sql);
    return rows;
  } catch (e) {
    if (isNoSuchTableError(e)) {
      console.warn('[dashboard] tabela ausente:', e.message);
      return fallback;
    }
    throw e;
  }
}

function firstRow(rows) {
  if (!rows || !rows.length) return {};
  return rows[0];
}

export async function getDashboardStats(req, res) {
  const period = PERIODS.has(String(req.query.period || '').toLowerCase())
    ? String(req.query.period).toLowerCase()
    : 'month';
  const pLeads = periodPredicate('l.created_at', period);
  const pVisitsSched = periodPredicate('v.scheduled_at', period);
  const pVisitsCreated = periodPredicate('v.created_at', period);
  const pProposalsSent = periodPredicate('COALESCE(pr.sent_at, pr.updated_at)', period);
  const pProposalsAccepted = periodPredicate('pr.accepted_at', period);
  const pLeadUpdated = periodPredicate('l.updated_at', period);

  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [
      leadsReceived,
      leadsNewToday,
      contactPending,
      visitsScheduled,
      visitsCompleted,
      visitsToday,
      proposalsSent,
      proposalsOpen,
      closedWon,
      closedWonValue,
      closedLost,
      inProduction,
      convLeadsTotal,
      convLeadsReachedVisit,
      visitsCompletedPeriod,
      visitsWithProposal,
      propWinNum,
      propWinDen,
      avgDeal,
      revenueMonth,
      revenueProjected,
      expensesMonth,
      avgMargin,
      funnelRows,
      recentLeadsRows,
      visitsTodayList,
      staleOpenProposals,
      staleSentProposals,
      visitsTodayUnconfirmed,
      newLeadsUrgent,
      upcomingVisits,
    ] = await Promise.all([
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM leads l WHERE ${pLeads}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM leads l WHERE DATE(l.created_at) = CURDATE()`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'lead_received'
         WHERE l.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
           AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.lead_id = l.id)`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v WHERE v.status = 'scheduled' AND ${pVisitsSched}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v WHERE v.status = 'completed' AND ${pVisitsCreated}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v WHERE DATE(v.scheduled_at) = CURDATE()`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM proposals pr WHERE pr.status = 'sent' AND ${pProposalsSent}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(pr.total_value), 0) AS val
         FROM proposals pr
         WHERE pr.status IN ('sent', 'draft', 'viewed', 'created')`,
        [{ cnt: 0, val: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'closed_won'
         WHERE ${pLeadUpdated}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COALESCE(SUM(pr.total_value), 0) AS s
         FROM proposals pr
         WHERE pr.status = 'accepted' AND ${pProposalsAccepted}`,
        [{ s: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'closed_lost'
         WHERE ${pLeadUpdated}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id AND ps.slug = 'production'`,
        [{ c: 0 }]
      ),
      safeQuery(pool, `SELECT COUNT(*) AS c FROM leads l WHERE ${pLeads}`, [{ c: 0 }]),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM leads l
         INNER JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         WHERE ${pLeads} AND ps.order_num >= 4`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v WHERE v.status = 'completed' AND ${pVisitsCreated}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c
         FROM visits v
         WHERE v.status = 'completed'
           AND ${pVisitsCreated}
           AND EXISTS (SELECT 1 FROM proposals pr WHERE pr.lead_id = v.lead_id)`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM proposals pr WHERE pr.status = 'accepted' AND ${pProposalsSent}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM proposals pr
         WHERE pr.status IN ('accepted', 'rejected') AND ${pProposalsSent}`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COALESCE(AVG(pr.total_value), 0) AS a
         FROM proposals pr
         WHERE pr.status = 'accepted' AND ${pProposalsAccepted}`,
        [{ a: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COALESCE(SUM(pf.actual_revenue), 0) AS s
         FROM project_financials pf
         WHERE pf.updated_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
        [{ s: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT
           (SELECT COALESCE(SUM(pr1.total_value), 0) FROM proposals pr1 WHERE pr1.status = 'accepted')
         + (SELECT COALESCE(SUM(pr2.total_value), 0)
              FROM proposals pr2
              INNER JOIN leads l2 ON l2.id = pr2.lead_id
              INNER JOIN pipeline_stages ps2 ON ps2.id = l2.pipeline_stage_id
              WHERE ps2.slug = 'negotiation'
                AND pr2.status IN ('draft', 'sent', 'viewed', 'created')) AS s`,
        [{ s: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COALESCE(SUM(e.total_amount), 0) AS s
         FROM expenses e
         WHERE e.status IN ('approved', 'paid')
           AND e.expense_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
        [{ s: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COALESCE(AVG(pf.actual_margin_percentage), 0) AS a
         FROM project_financials pf
         INNER JOIN projects p ON p.id = pf.project_id
         WHERE p.status = 'in_progress'`,
        [{ a: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT ps.id AS stage_id, ps.name AS stage_name, ps.slug, ps.order_num,
                COUNT(l.id) AS cnt,
                COALESCE(SUM(px.tv), 0) AS stage_value
         FROM pipeline_stages ps
         LEFT JOIN leads l ON l.pipeline_stage_id = ps.id
         LEFT JOIN (
           SELECT lead_id, MAX(total_value) AS tv FROM proposals GROUP BY lead_id
         ) px ON px.lead_id = l.id
         GROUP BY ps.id, ps.name, ps.slug, ps.order_num
         ORDER BY ps.order_num ASC`,
        []
      ),
      safeQuery(
        pool,
        `SELECT l.id, l.name, l.source, l.created_at,
                ps.name AS pipeline_stage_name, ps.id AS stage_id, ps.slug AS pipeline_stage_slug
         FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         ORDER BY l.created_at DESC
         LIMIT 5`,
        []
      ),
      safeQuery(
        pool,
        `SELECT v.scheduled_at, v.status, l.name AS client_name, l.id AS lead_id
         FROM visits v
         INNER JOIN leads l ON l.id = v.lead_id
         WHERE DATE(v.scheduled_at) = CURDATE()
         ORDER BY v.scheduled_at ASC`,
        []
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM proposals pr
         WHERE pr.status IN ('draft', 'sent', 'viewed')
           AND pr.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
           AND pr.status NOT IN ('accepted', 'rejected')`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM proposals pr
         WHERE pr.status = 'sent'
           AND COALESCE(pr.sent_at, pr.updated_at) < DATE_SUB(NOW(), INTERVAL 14 DAY)
           AND pr.status NOT IN ('accepted', 'rejected')`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT COUNT(*) AS c FROM visits v
         WHERE DATE(v.scheduled_at) = CURDATE()
           AND v.status = 'scheduled'
           AND v.confirmed_at IS NULL`,
        [{ c: 0 }]
      ),
      safeQuery(
        pool,
        `SELECT id, name, email, phone, created_at FROM leads
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
         ORDER BY created_at DESC`,
        []
      ),
      safeQuery(
        pool,
        `SELECT v.id, v.scheduled_at, v.status,
                l.name AS lead_name, c.name AS customer_name, p.name AS project_name
         FROM visits v
         LEFT JOIN leads l ON v.lead_id = l.id
         LEFT JOIN customers c ON v.customer_id = c.id
         LEFT JOIN projects p ON v.project_id = p.id
         WHERE v.scheduled_at >= NOW() AND v.scheduled_at <= DATE_ADD(NOW(), INTERVAL 7 DAY)
         ORDER BY v.scheduled_at ASC
         LIMIT 10`,
        []
      ),
    ]);

    const lr = Number(firstRow(leadsReceived).c) || 0;
    const lnt = Number(firstRow(leadsNewToday).c) || 0;
    const cp = Number(firstRow(contactPending).c) || 0;
    const vs = Number(firstRow(visitsScheduled).c) || 0;
    const vc = Number(firstRow(visitsCompleted).c) || 0;
    const vt = Number(firstRow(visitsToday).c) || 0;
    const psent = Number(firstRow(proposalsSent).c) || 0;
    const po = firstRow(proposalsOpen);
    const proposalsOpenCount = Number(po.cnt) || 0;
    const proposalsOpenValue = parseFloat(po.val) || 0;
    const cwc = Number(firstRow(closedWon).c) || 0;
    const cwv = parseFloat(firstRow(closedWonValue).s) || 0;
    const clc = Number(firstRow(closedLost).c) || 0;
    const iprod = Number(firstRow(inProduction).c) || 0;

    const denomL = Number(firstRow(convLeadsTotal).c) || 0;
    const numLV = Number(firstRow(convLeadsReachedVisit).c) || 0;
    const leadToVisit = denomL > 0 ? Math.round((numLV / denomL) * 1000) / 10 : 0;

    const denomVisit = Number(firstRow(visitsCompletedPeriod).c) || 0;
    const numVP = Number(firstRow(visitsWithProposal).c) || 0;
    const visitToProposal = denomVisit > 0 ? Math.round((numVP / denomVisit) * 1000) / 10 : 0;

    const numAcc = Number(firstRow(propWinNum).c) || 0;
    const denWin = Number(firstRow(propWinDen).c) || 0;
    const proposalWin = denWin > 0 ? Math.round((numAcc / denWin) * 1000) / 10 : 0;

    const avgDealVal = parseFloat(firstRow(avgDeal).a) || 0;

    const revM = parseFloat(firstRow(revenueMonth).s) || 0;
    const revP = parseFloat(firstRow(revenueProjected).s) || 0;
    const expM = parseFloat(firstRow(expensesMonth).s) || 0;
    const profitM = Math.round((revM - expM) * 100) / 100;
    const avgMarg = Math.round((parseFloat(firstRow(avgMargin).a) || 0) * 10) / 10;

    const alerts = [];
    if (cp > 0) {
      alerts.push({
        type: 'warning',
        message: 'Leads sem primeiro contato há mais de 24h',
        count: cp,
        action_url: '/leads?filter=no_contact',
      });
    }
    if (Number(firstRow(visitsTodayUnconfirmed).c) > 0) {
      const n = Number(firstRow(visitsTodayUnconfirmed).c) || 0;
      alerts.push({
        type: 'info',
        message: 'Visitas de hoje ainda sem confirmação',
        count: n,
        action_url: '/schedule',
      });
    }
    const sop = Number(firstRow(staleOpenProposals).c) || 0;
    if (sop > 0) {
      alerts.push({
        type: 'warning',
        message: 'Propostas em aberto há mais de 7 dias',
        count: sop,
        action_url: '/crm',
      });
    }
    const ssp = Number(firstRow(staleSentProposals).c) || 0;
    if (ssp > 0) {
      alerts.push({
        type: 'danger',
        message: 'Propostas enviadas há mais de 14 dias sem resposta',
        count: ssp,
        action_url: '/crm',
      });
    }

    const pipelineFunnel = (funnelRows || []).map((row) => ({
      stage_id: row.stage_id,
      stage_name: row.stage_name,
      slug: row.slug,
      count: Number(row.cnt) || 0,
      value: Math.round((parseFloat(row.stage_value) || 0) * 100) / 100,
    }));

    const now = Date.now();
    const recent_leads = (recentLeadsRows || []).map((l) => ({
      id: l.id,
      name: l.name,
      pipeline_stage: l.pipeline_stage_name || '—',
      stage_id: l.stage_id,
      slug: l.pipeline_stage_slug,
      source: l.source || '—',
      time_ago: timeAgoLabel(l.created_at, now),
      created_at: l.created_at,
    }));

    const visits_today_detail = (visitsTodayList || []).map((v) => ({
      scheduled_at: v.scheduled_at,
      status: v.status,
      client_name: v.client_name,
      lead_id: v.lead_id,
    }));

    const new_leads_urgent = newLeadsUrgent || [];
    const new_leads_urgent_count = new_leads_urgent.length;

    return res.json({
      success: true,
      period,
      generated_at: new Date().toISOString(),
      pipeline: {
        leads_received: lr,
        leads_new_today: lnt,
        contact_pending: cp,
        visits_scheduled: vs,
        visits_completed: vc,
        visits_today: vt,
        proposals_sent: psent,
        proposals_open_count: proposalsOpenCount,
        proposals_open_value: Math.round(proposalsOpenValue * 100) / 100,
        closed_won_count: cwc,
        closed_won_value: Math.round(cwv * 100) / 100,
        closed_lost_count: clc,
        in_production: iprod,
      },
      conversion: {
        lead_to_visit_rate: leadToVisit,
        visit_to_proposal_rate: visitToProposal,
        proposal_win_rate: proposalWin,
        avg_deal_value: Math.round(avgDealVal * 100) / 100,
      },
      financial: {
        revenue_month: Math.round(revM * 100) / 100,
        revenue_projected: Math.round(revP * 100) / 100,
        expenses_month: Math.round(expM * 100) / 100,
        profit_month: profitM,
        avg_margin: avgMarg,
      },
      alerts,
      recent_leads,
      pipeline_funnel: pipelineFunnel,
      visits_today_detail,
      new_leads_urgent,
      new_leads_urgent_count,
      upcoming_visits: upcomingVisits || [],
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal error' });
  }
}

function timeAgoLabel(iso, nowMs) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const sec = Math.floor((nowMs - t) / 1000);
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dias`;
}
