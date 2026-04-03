/**
 * Dashboard API - Statistics and overview
 */
import { getDBConnection } from '../config/db.js';

export async function getDashboardStats(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    // Estatísticas de Leads
    const [leadsStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
        SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
        SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) as qualified,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
        SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as this_week
      FROM leads
    `);

    // Estatísticas de clients (tabela customers)
    const [customersStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as this_month
      FROM customers
    `);

    // Estatísticas de Quotes (won_quotes_value alinhado à receita: aprovado/aceite OU lead em Fechado-Ganhou, sem contrato)
    const [quotesStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN q.status = 'draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN q.status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN q.status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN q.status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        COALESCE(SUM(q.total_amount), 0) as total_value,
        COALESCE(SUM(CASE WHEN q.status = 'accepted' THEN q.total_amount ELSE 0 END), 0) as accepted_value,
        COALESCE(SUM(CASE
          WHEN NOT EXISTS (SELECT 1 FROM contracts c WHERE c.quote_id = q.id)
           AND (
             q.status IN ('approved', 'accepted')
             OR ps.slug = 'closed_won'
             OR l.status IN ('closed_won', 'converted')
           )
          THEN q.total_amount ELSE 0 END), 0) as won_quotes_value
      FROM quotes q
      LEFT JOIN customers quote_cust ON quote_cust.id = q.customer_id
      LEFT JOIN leads l ON l.id = COALESCE(q.lead_id, quote_cust.lead_id)
      LEFT JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
    `);

    // Estatísticas de Projects
    const [projectsStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
      FROM projects
    `);

    // Contratos + orçamentos aprovados/aceites sem contrato ligado (evita duplicar quando quote_id existe)
    let contractsStats = {
      total: 0,
      contracts_revenue: 0,
      won_quotes_revenue: 0,
      total_revenue: 0,
      contracts_this_month: 0,
      won_quotes_this_month: 0,
      this_month_revenue: 0,
    };
    try {
      const [[cRow]] = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COALESCE(SUM(closed_amount), 0) as contracts_revenue,
          COALESCE(SUM(CASE WHEN DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN closed_amount ELSE 0 END), 0) as contracts_this_month
        FROM contracts
      `);
      const [[wqRow]] = await pool.query(`
        SELECT 
          COALESCE(SUM(q.total_amount), 0) AS won_quotes_revenue,
          COALESCE(SUM(CASE 
            WHEN DATE(COALESCE(q.approved_at, q.updated_at, l.updated_at, q.created_at)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            THEN q.total_amount ELSE 0 END), 0) AS won_quotes_this_month
        FROM quotes q
        LEFT JOIN customers quote_cust ON quote_cust.id = q.customer_id
        LEFT JOIN leads l ON l.id = COALESCE(q.lead_id, quote_cust.lead_id)
        LEFT JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
        WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.quote_id = q.id)
          AND (
            q.status IN ('approved', 'accepted')
            OR ps.slug = 'closed_won'
            OR l.status IN ('closed_won', 'converted')
          )
      `);
      const cr = parseFloat(cRow.contracts_revenue) || 0;
      const wq = parseFloat(wqRow.won_quotes_revenue) || 0;
      const ctm = parseFloat(cRow.contracts_this_month) || 0;
      const wtm = parseFloat(wqRow.won_quotes_this_month) || 0;
      contractsStats = {
        total: cRow.total || 0,
        contracts_revenue: cr,
        won_quotes_revenue: wq,
        total_revenue: Math.round((cr + wq) * 100) / 100,
        contracts_this_month: ctm,
        won_quotes_this_month: wtm,
        this_month_revenue: Math.round((ctm + wtm) * 100) / 100,
      };
    } catch (e) {
      console.warn('Dashboard contracts/won-quotes revenue:', e.message);
      try {
        const [[fallback]] = await pool.query(`
          SELECT 
            COUNT(*) as total,
            COALESCE(SUM(closed_amount), 0) as total_revenue,
            COALESCE(SUM(CASE WHEN DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN closed_amount ELSE 0 END), 0) as this_month_revenue
          FROM contracts
        `);
        contractsStats = {
          total: fallback.total || 0,
          contracts_revenue: parseFloat(fallback.total_revenue) || 0,
          won_quotes_revenue: 0,
          total_revenue: parseFloat(fallback.total_revenue) || 0,
          contracts_this_month: parseFloat(fallback.this_month_revenue) || 0,
          won_quotes_this_month: 0,
          this_month_revenue: parseFloat(fallback.this_month_revenue) || 0,
        };
      } catch (e2) {
        console.warn('Dashboard contracts fallback:', e2.message);
      }
    }

    // Leads criados por mês (últimos 12 meses) — substitui dados fictícios no gráfico
    let leads_by_month = [];
    try {
      const [lmRows] = await pool.query(
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COUNT(*) AS cnt
         FROM leads
         WHERE created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')
         GROUP BY ym
         ORDER BY ym ASC`
      );
      leads_by_month = lmRows;
    } catch (e) {
      console.warn('Dashboard leads_by_month:', e.message);
    }

    // Valor ganho por orçamento agrupado por vendedor (assigned_to)
    let sales_by_rep = [];
    try {
      const [repRows] = await pool.query(
        `SELECT q.assigned_to AS user_id,
                COALESCE(u.name, CONCAT('User #', q.assigned_to)) AS rep_name,
                COALESCE(SUM(q.total_amount), 0) AS won_amount,
                COUNT(*) AS won_count
         FROM quotes q
         LEFT JOIN customers quote_cust ON quote_cust.id = q.customer_id
         LEFT JOIN leads l ON l.id = COALESCE(q.lead_id, quote_cust.lead_id)
         LEFT JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         LEFT JOIN users u ON u.id = q.assigned_to
         WHERE q.assigned_to IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.quote_id = q.id)
           AND (
             q.status IN ('approved', 'accepted')
             OR ps.slug = 'closed_won'
             OR l.status IN ('closed_won', 'converted')
           )
         GROUP BY q.assigned_to, u.name
         ORDER BY won_amount DESC
         LIMIT 10`
      );
      sales_by_rep = repRows;
    } catch (e) {
      console.warn('Dashboard sales_by_rep:', e.message);
    }

    // Visits agendadas hoje e esta semana
    const [visitsStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN DATE(scheduled_at) = CURDATE() THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN DATE(scheduled_at) >= CURDATE() AND DATE(scheduled_at) <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as this_week,
        SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
      FROM visits
    `);

    // Leads recentes (últimos 10)
    const [recentLeads] = await pool.query(`
      SELECT id, name, email, phone, status, created_at 
      FROM leads 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    // Leads novos (últimos 30 min) — urgência de contato
    const [newLeadsUrgent] = await pool.query(`
      SELECT id, name, email, phone, created_at 
      FROM leads 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
      ORDER BY created_at DESC
    `);
    const new_leads_urgent_count = newLeadsUrgent.length;

    // Visits próximas (próximos 7 dias)
    const [upcomingVisits] = await pool.query(`
      SELECT v.id, v.scheduled_at, v.status,
             l.name as lead_name, c.name as customer_name, p.name as project_name
      FROM visits v
      LEFT JOIN leads l ON v.lead_id = l.id
      LEFT JOIN customers c ON v.customer_id = c.id
      LEFT JOIN projects p ON v.project_id = p.id
      WHERE v.scheduled_at >= NOW() AND v.scheduled_at <= DATE_ADD(NOW(), INTERVAL 7 DAY)
      ORDER BY v.scheduled_at ASC
      LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        leads: leadsStats[0],
        customers: customersStats[0],
        quotes: quotesStats[0],
        projects: projectsStats[0],
        contracts: contractsStats,
        visits: visitsStats[0],
        recent_leads: recentLeads,
        upcoming_visits: upcomingVisits,
        new_leads_urgent_count: new_leads_urgent_count,
        new_leads_urgent: newLeadsUrgent,
        leads_by_month,
        sales_by_rep,
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
