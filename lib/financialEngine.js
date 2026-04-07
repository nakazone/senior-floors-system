/**
 * Motor central de cálculos financeiros (empresa).
 * Queries defensivas: tabelas/colunas em falta retornam zeros.
 */

async function safeQuery(pool, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn('[financialEngine]', e.code || '', e.message);
    return null;
  }
}

function deletedAtClause(alias = 'p') {
  return `AND (${alias}.deleted_at IS NULL OR ${alias}.deleted_at = '0000-00-00 00:00:00')`;
}

/** P&L agregado da empresa no período */
export async function getCompanyPL(pool, periodStart, periodEnd) {
  const del = deletedAtClause('p');

  const revenueRows = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT
        COALESCE(SUM(p.contract_value), 0) AS total_revenue,
        COUNT(p.id) AS projects_count,
        COALESCE(AVG(
          (p.contract_value - (COALESCE(p.labor_cost_actual,0) + COALESCE(p.material_cost_actual,0) + COALESCE(p.additional_cost_actual,0)))
          / NULLIF(p.contract_value, 0) * 100
        ), 0) AS avg_margin_pct
      FROM projects p
      WHERE p.status = 'completed'
        AND COALESCE(p.end_date_actual, p.end_date_estimated) >= ?
        AND COALESCE(p.end_date_actual, p.end_date_estimated) <= ?
        ${del}`,
      [periodStart, periodEnd]
    );
    return r;
  });

  const payrollRows = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT
        COALESCE(SUM(pe.total_cost), 0) AS total_payroll,
        COUNT(DISTINCT pe.employee_id) AS employees_count,
        COALESCE(SUM(pe.hours_worked), 0) AS total_hours
      FROM payroll_entries pe
      WHERE pe.approved = 1
        AND pe.date >= ? AND pe.date <= ?`,
      [periodStart, periodEnd]
    );
    return r;
  });

  const projectCostRows = await safeQuery(pool, async () => {
    const [hasProj] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_costs' AND COLUMN_NAME = 'is_projected'`
    );
    const projFilter = Number(hasProj[0]?.c) > 0 ? 'AND IFNULL(pc.is_projected,0)=0' : '';
    const [r] = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN pc.cost_type='labor' THEN pc.total_cost ELSE 0 END), 0) AS labor,
        COALESCE(SUM(CASE WHEN pc.cost_type='material' THEN pc.total_cost ELSE 0 END), 0) AS material,
        COALESCE(SUM(CASE WHEN pc.cost_type='additional' THEN pc.total_cost ELSE 0 END), 0) AS additional
      FROM project_costs pc
      JOIN projects p ON pc.project_id = p.id
      WHERE 1=1 ${projFilter}
        AND DATE(pc.created_at) >= ? AND DATE(pc.created_at) <= ?
        ${del}`,
      [periodStart, periodEnd]
    );
    return r;
  });

  let operationalRows = [];
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT category, COALESCE(SUM(total_amount), 0) AS amount
      FROM operational_costs
      WHERE status IN ('paid','recurring')
        AND expense_date >= ? AND expense_date <= ?
        AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')
      GROUP BY category`,
      [periodStart, periodEnd]
    );
    operationalRows = r || [];
    return r;
  });

  const marketingRows = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT COALESCE(SUM(spend), 0) AS total_marketing
      FROM ad_spend
      WHERE period_start <= ? AND period_end >= ?
        AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')`,
      [periodEnd, periodStart]
    );
    return r;
  });

  const receivedRows = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_received
      FROM payment_receipts
      WHERE payment_date >= ? AND payment_date <= ?`,
      [periodStart, periodEnd]
    );
    return r;
  });

  const revenue = parseFloat(revenueRows?.[0]?.total_revenue) || 0;
  const payroll = parseFloat(payrollRows?.[0]?.total_payroll) || 0;
  const projectCosts =
    (parseFloat(projectCostRows?.[0]?.labor) || 0) +
    (parseFloat(projectCostRows?.[0]?.material) || 0) +
    (parseFloat(projectCostRows?.[0]?.additional) || 0);
  const operational = operationalRows.reduce((s, row) => s + (parseFloat(row.amount) || 0), 0);
  const marketing = parseFloat(marketingRows?.[0]?.total_marketing) || 0;
  const received = parseFloat(receivedRows?.[0]?.total_received) || 0;

  const totalCosts = payroll + projectCosts + operational + marketing;
  const grossProfit = revenue - (payroll + projectCosts);
  const netProfit = revenue - totalCosts;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  const topProjects = await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT
        p.id,
        COALESCE(p.project_number, CONCAT('PRJ-', p.id)) AS project_label,
        COALESCE(p.contract_value, 0) AS contract_value,
        (COALESCE(p.labor_cost_actual,0) + COALESCE(p.material_cost_actual,0) + COALESCE(p.additional_cost_actual,0)) AS cost_total,
        COALESCE(p.contract_value,0) - (COALESCE(p.labor_cost_actual,0) + COALESCE(p.material_cost_actual,0) + COALESCE(p.additional_cost_actual,0)) AS profit,
        p.status,
        CASE WHEN COALESCE(p.contract_value,0) > 0 THEN
          (COALESCE(p.contract_value,0) - (COALESCE(p.labor_cost_actual,0) + COALESCE(p.material_cost_actual,0) + COALESCE(p.additional_cost_actual,0)))
          / p.contract_value * 100 ELSE 0 END AS margin_pct
      FROM projects p
      WHERE p.status = 'completed'
        AND COALESCE(p.end_date_actual, p.end_date_estimated) >= ?
        AND COALESCE(p.end_date_actual, p.end_date_estimated) <= ?
        ${del}
      ORDER BY profit DESC
      LIMIT 10`,
      [periodStart, periodEnd]
    );
    return r;
  });

  return {
    revenue,
    received,
    costs: {
      payroll,
      project: projectCosts,
      operational,
      marketing,
      total: totalCosts,
    },
    operational_breakdown: operationalRows,
    gross_profit: grossProfit,
    gross_margin_pct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    net_profit: netProfit,
    net_margin_pct: netMargin,
    projects_count: parseInt(revenueRows?.[0]?.projects_count, 10) || 0,
    employees_count: parseInt(payrollRows?.[0]?.employees_count, 10) || 0,
    total_hours: parseFloat(payrollRows?.[0]?.total_hours) || 0,
    top_projects: topProjects || [],
  };
}

/** Previsão semanal (heurística) */
export async function generateWeeklyForecast(pool, weekStart) {
  const d0 = new Date(`${weekStart}T12:00:00`);
  const weekEnd = new Date(d0);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const wEnd = weekEnd.toISOString().slice(0, 10);

  let payrollForecast = [];
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT
        p.id AS project_id,
        COALESCE(p.project_number, CONCAT('PRJ-', p.id)) AS project_name,
        ps.crew_id,
        c.name AS crew_name,
        GREATEST(0,
          DATEDIFF(LEAST(ps.end_date, ?), GREATEST(ps.start_date, ?)) + 1
        ) AS days_overlap,
        COALESCE(
          (SELECT AVG(pe.hourly_rate * 8) FROM payroll_entries pe
           WHERE pe.crew_id = ps.crew_id AND pe.approved = 1),
          200
        ) AS daily_rate_avg
      FROM project_schedules ps
      JOIN projects p ON ps.project_id = p.id
      JOIN crews c ON ps.crew_id = c.id
      WHERE ps.status IN ('scheduled', 'in_progress')
        AND ps.start_date <= ? AND ps.end_date >= ?
        ${deletedAtClause('p')}`,
      [wEnd, weekStart, wEnd, weekStart]
    );
    payrollForecast = r || [];
    return r;
  });

  let recurringCosts = [];
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT *
      FROM operational_costs
      WHERE is_recurring = 1
        AND status IN ('paid','recurring','pending')
        AND (recurrence_end_date IS NULL OR recurrence_end_date >= ?)
        AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')`,
      [weekStart]
    );
    recurringCosts = r || [];
    return r;
  });

  let materialsPending = [];
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT pm.*, COALESCE(p.project_number, CONCAT('PRJ-', p.id)) AS project_name
      FROM project_materials pm
      JOIN projects p ON pm.project_id = p.id
      WHERE pm.status IN ('ordered', 'partial')
        AND (
          (pm.order_date IS NOT NULL AND pm.order_date <= ?)
          OR (pm.received_date IS NOT NULL AND pm.received_date BETWEEN ? AND ?)
        )
        ${deletedAtClause('p')}`,
      [wEnd, weekStart, wEnd]
    );
    materialsPending = r || [];
    return r;
  });

  let marketingTotal = 0;
  await safeQuery(pool, async () => {
    const [r] = await pool.query(
      `SELECT COALESCE(SUM(
        spend * (GREATEST(0, DATEDIFF(LEAST(period_end, ?), GREATEST(period_start, ?)) + 1))
        / GREATEST(DATEDIFF(period_end, period_start) + 1, 1)
      ), 0) AS weekly_marketing
      FROM ad_spend
      WHERE period_start <= ? AND period_end >= ?
        AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')`,
      [wEnd, weekStart, wEnd, weekStart]
    );
    marketingTotal = parseFloat(r[0]?.weekly_marketing) || 0;
    return r;
  });

  const payrollTotal = payrollForecast.reduce((s, row) => {
    return s + (parseFloat(row.days_overlap) || 0) * (parseFloat(row.daily_rate_avg) || 0);
  }, 0);
  const operationalTotal = recurringCosts.reduce((s, row) => s + (parseFloat(row.total_amount) || 0), 0);
  const materialsTotal = materialsPending.reduce((s, row) => s + (parseFloat(row.total_cost) || 0), 0);

  return {
    week_start: weekStart,
    week_end: wEnd,
    forecast: {
      payroll: { amount: payrollTotal, items: payrollForecast },
      operational: { amount: operationalTotal, items: recurringCosts },
      materials: { amount: materialsTotal, items: materialsPending },
      marketing: { amount: marketingTotal, items: [] },
      total: payrollTotal + operationalTotal + materialsTotal + marketingTotal,
    },
  };
}

export async function updateVendorTotalSpent(pool, vendorId) {
  if (!vendorId) return;
  await safeQuery(pool, async () => {
    const [[exp]] = await pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS t FROM expenses
       WHERE vendor_id = ? AND status = 'paid'`,
      [vendorId]
    );
    const [[op]] = await pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS t FROM operational_costs
       WHERE vendor_id = ? AND status IN ('paid','recurring')
       AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')`,
      [vendorId]
    );
    const total = (parseFloat(exp?.t) || 0) + (parseFloat(op?.t) || 0);
    await pool.query('UPDATE vendors SET total_spent = ?, updated_at = NOW() WHERE id = ?', [total, vendorId]);
    return true;
  });
}

export async function importMarketingCosts(pool, periodStart, periodEnd) {
  const rows =
    (await safeQuery(pool, async () => {
      const [r] = await pool.query(
        `SELECT platform, campaign_name, SUM(spend) AS total_spend,
        MIN(period_start) AS period_start, MAX(period_end) AS period_end
      FROM ad_spend
      WHERE period_start <= ? AND period_end >= ?
        AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')
      GROUP BY platform, campaign_name`,
        [periodEnd, periodStart]
      );
      return r;
    })) || [];
  if (!rows.length) return { imported: 0 };

  let imported = 0;
  for (const row of rows) {
    const desc = `[Marketing] ${row.campaign_name} (${row.platform})`;
    const [[existing]] = await pool.query(
      `SELECT id FROM expenses
       WHERE category = 'other'
         AND description = ?
         AND expense_date >= ? AND expense_date <= ?
       LIMIT 1`,
      [desc, periodStart, periodEnd]
    );
    if (existing) continue;
    const amt = parseFloat(row.total_spend) || 0;
    await pool.query(
      `INSERT INTO expenses (category, description, amount, total_amount, expense_date, status)
       VALUES ('other', ?, ?, ?, ?, 'approved')`,
      [desc, amt, amt, row.period_start || periodStart]
    );
    imported += 1;
  }
  return { imported };
}
