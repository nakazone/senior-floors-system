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

    // Estatísticas de Quotes
    const [quotesStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        COALESCE(SUM(total_amount), 0) as total_value,
        COALESCE(SUM(CASE WHEN status = 'accepted' THEN total_amount ELSE 0 END), 0) as accepted_value
      FROM quotes
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

    // Estatísticas de Contracts/Financeiro
    const [contractsStats] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(closed_amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN closed_amount ELSE 0 END), 0) as this_month_revenue
      FROM contracts
    `);

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
        contracts: contractsStats[0],
        visits: visitsStats[0],
        recent_leads: recentLeads,
        upcoming_visits: upcomingVisits,
        new_leads_urgent_count: new_leads_urgent_count,
        new_leads_urgent: newLeadsUrgent
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
