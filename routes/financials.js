/**
 * Financial Management API
 * Gestão financeira completa
 */

import { getDBConnection } from '../config/db.js';
import {
  recalculateProjectFinancial,
  allocateExpense,
  allocatePayroll,
  calculateRealTimeProfitAnalysis
} from '../services/financialCalculator.js';

/**
 * Obter financial de um projeto
 */
export async function getProjectFinancial(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.projectId);
    
    let [financials] = await pool.query(
      `SELECT pf.*, p.project_number, p.status as project_status
       FROM project_financials pf
       JOIN projects p ON pf.project_id = p.id
       WHERE pf.project_id = ?`,
      [projectId]
    );
    
    if (financials.length === 0) {
      // Criar financial inicial se não existir
      await pool.execute(
        `INSERT INTO project_financials (project_id) VALUES (?)`,
        [projectId]
      );
      [financials] = await pool.query(
        `SELECT pf.*, p.project_number, p.status as project_status
         FROM project_financials pf
         JOIN projects p ON pf.project_id = p.id
         WHERE pf.project_id = ?`,
        [projectId]
      );
    }
    
    const financial = financials[0];
    const analysis = await calculateRealTimeProfitAnalysis(pool, projectId);
    
    return res.json({ success: true, data: analysis || financial });
  } catch (error) {
    console.error('Error getting project financial:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Atualizar financial do projeto
 */
export async function updateProjectFinancial(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.projectId);
    
    const {
      estimated_revenue,
      estimated_material_cost,
      estimated_labor_cost,
      estimated_overhead,
      actual_revenue,
      actual_material_cost,
      actual_labor_cost,
      actual_overhead,
      is_locked
    } = req.body;
    
    // Buscar financial existente
    let [financials] = await pool.query(
      'SELECT * FROM project_financials WHERE project_id = ?',
      [projectId]
    );
    
    if (financials.length === 0) {
      // Criar se não existir
      await pool.execute(
        `INSERT INTO project_financials (project_id) VALUES (?)`,
        [projectId]
      );
      [financials] = await pool.query(
        'SELECT * FROM project_financials WHERE project_id = ?',
        [projectId]
      );
    }
    
    const financial = financials[0];
    
    // Atualizar campos fornecidos
    const updates = [];
    const values = [];
    
    if (estimated_revenue !== undefined) {
      updates.push('estimated_revenue = ?');
      values.push(estimated_revenue);
    }
    if (estimated_material_cost !== undefined) {
      updates.push('estimated_material_cost = ?');
      values.push(estimated_material_cost);
    }
    if (estimated_labor_cost !== undefined) {
      updates.push('estimated_labor_cost = ?');
      values.push(estimated_labor_cost);
    }
    if (estimated_overhead !== undefined) {
      updates.push('estimated_overhead = ?');
      values.push(estimated_overhead);
    }
    if (actual_revenue !== undefined) {
      updates.push('actual_revenue = ?');
      values.push(actual_revenue);
    }
    if (actual_material_cost !== undefined) {
      updates.push('actual_material_cost = ?');
      values.push(actual_material_cost);
    }
    if (actual_labor_cost !== undefined) {
      updates.push('actual_labor_cost = ?');
      values.push(actual_labor_cost);
    }
    if (actual_overhead !== undefined) {
      updates.push('actual_overhead = ?');
      values.push(actual_overhead);
    }
    if (is_locked !== undefined) {
      updates.push('is_locked = ?');
      values.push(is_locked ? 1 : 0);
      if (is_locked) {
        updates.push('locked_at = NOW()');
        updates.push('locked_by = ?');
        values.push(req.session?.user?.id);
      }
    }
    
    if (updates.length > 0) {
      values.push(projectId);
      await pool.execute(
        `UPDATE project_financials SET ${updates.join(', ')} WHERE project_id = ?`,
        values
      );
    }
    
    // Recalcular valores
    const updatedFinancial = await calculateRealTimeProfitAnalysis(pool, projectId);
    
    return res.json({ success: true, data: updatedFinancial });
  } catch (error) {
    console.error('Error updating project financial:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Listar expenses
 */
export async function listExpenses(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
    const category = req.query.category || null;
    const status = req.query.status || null;
    const startDate = req.query.start_date || null;
    const endDate = req.query.end_date || null;
    
    let whereClause = '1=1';
    const params = [];
    
    if (projectId) {
      whereClause += ' AND e.project_id = ?';
      params.push(projectId);
    }
    if (category) {
      whereClause += ' AND e.category = ?';
      params.push(category);
    }
    if (status) {
      whereClause += ' AND e.status = ?';
      params.push(status);
    }
    if (startDate) {
      whereClause += ' AND e.expense_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND e.expense_date <= ?';
      params.push(endDate);
    }
    
    const [rows] = await pool.query(
      `SELECT e.*,
              p.project_number,
              u1.name as created_by_name,
              u2.name as approved_by_name
       FROM expenses e
       LEFT JOIN projects p ON e.project_id = p.id
       LEFT JOIN users u1 ON e.created_by = u1.id
       LEFT JOIN users u2 ON e.approved_by = u2.id
       WHERE ${whereClause}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT 100`,
      params
    );
    
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing expenses:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Criar expense
 */
export async function createExpense(req, res) {
  try {
    const pool = await getDBConnection();
    const userId = req.session?.user?.id;
    
    const {
      category,
      project_id,
      vendor,
      description,
      amount,
      tax_amount = 0,
      payment_method,
      expense_date,
      receipt_url,
      receipt_file_path
    } = req.body;
    
    if (!category || !description || !amount || !expense_date) {
      return res.status(400).json({ 
        success: false, 
        error: 'category, description, amount, and expense_date are required' 
      });
    }
    
    const totalAmount = parseFloat(amount) + (parseFloat(tax_amount) || 0);
    
    const [result] = await pool.execute(
      `INSERT INTO expenses
       (category, project_id, vendor, description, amount, tax_amount, total_amount,
        payment_method, expense_date, receipt_url, receipt_file_path, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        category,
        project_id || null,
        vendor || null,
        description,
        amount,
        tax_amount || 0,
        totalAmount,
        payment_method || null,
        expense_date,
        receipt_url || null,
        receipt_file_path || null,
        userId
      ]
    );
    
    const [created] = await pool.query(
      `SELECT e.*, p.project_number
       FROM expenses e
       LEFT JOIN projects p ON e.project_id = p.id
       WHERE e.id = ?`,
      [result.insertId]
    );
    
    return res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    console.error('Error creating expense:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Aprovar expense
 */
export async function approveExpense(req, res) {
  try {
    const pool = await getDBConnection();
    const expenseId = parseInt(req.params.id);
    const userId = req.session?.user?.id;
    
    // Atualizar status
    await pool.execute(
      `UPDATE expenses 
       SET status = 'approved', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [userId, expenseId]
    );
    
    // Alocar automaticamente
    await allocateExpense(pool, expenseId);
    
    const [updated] = await pool.query('SELECT * FROM expenses WHERE id = ?', [expenseId]);
    
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error approving expense:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Listar payroll entries
 */
export async function listPayrollEntries(req, res) {
  try {
    const pool = await getDBConnection();
    const employeeId = req.query.employee_id ? parseInt(req.query.employee_id) : null;
    const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
    const approved = req.query.approved !== undefined ? req.query.approved === 'true' : null;
    
    let whereClause = '1=1';
    const params = [];
    
    if (employeeId) {
      whereClause += ' AND pe.employee_id = ?';
      params.push(employeeId);
    }
    if (projectId) {
      whereClause += ' AND pe.project_id = ?';
      params.push(projectId);
    }
    if (approved !== null) {
      whereClause += ' AND pe.approved = ?';
      params.push(approved ? 1 : 0);
    }
    
    const [rows] = await pool.query(
      `SELECT pe.*,
              u.name as employee_name,
              p.project_number,
              c.name as crew_name
       FROM payroll_entries pe
       JOIN users u ON pe.employee_id = u.id
       LEFT JOIN projects p ON pe.project_id = p.id
       LEFT JOIN crews c ON pe.crew_id = c.id
       WHERE ${whereClause}
       ORDER BY pe.date DESC
       LIMIT 100`,
      params
    );
    
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error listing payroll entries:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Criar payroll entry
 */
export async function createPayrollEntry(req, res) {
  try {
    const pool = await getDBConnection();
    const userId = req.session?.user?.id;
    
    const {
      employee_id,
      project_id,
      crew_id,
      date,
      hours_worked,
      hourly_rate,
      overtime_hours = 0,
      overtime_rate = null
    } = req.body;
    
    if (!employee_id || !date || !hours_worked || !hourly_rate) {
      return res.status(400).json({ 
        success: false, 
        error: 'employee_id, date, hours_worked, and hourly_rate are required' 
      });
    }
    
    const totalCost = parseFloat(hours_worked) * parseFloat(hourly_rate);
    const overtimeCost = parseFloat(overtime_hours) * (parseFloat(overtime_rate) || parseFloat(hourly_rate) * 1.5);
    
    const [result] = await pool.execute(
      `INSERT INTO payroll_entries
       (employee_id, project_id, crew_id, date, hours_worked, hourly_rate,
        total_cost, overtime_hours, overtime_rate, overtime_cost, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        project_id || null,
        crew_id || null,
        date,
        hours_worked,
        hourly_rate,
        totalCost,
        overtime_hours || 0,
        overtime_rate || null,
        overtimeCost,
        userId
      ]
    );
    
    const [created] = await pool.query(
      `SELECT pe.*, u.name as employee_name
       FROM payroll_entries pe
       JOIN users u ON pe.employee_id = u.id
       WHERE pe.id = ?`,
      [result.insertId]
    );
    
    return res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    console.error('Error creating payroll entry:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Aprovar payroll entry
 */
export async function approvePayrollEntry(req, res) {
  try {
    const pool = await getDBConnection();
    const entryId = parseInt(req.params.id);
    const userId = req.session?.user?.id;
    
    // Atualizar status
    await pool.execute(
      `UPDATE payroll_entries 
       SET approved = 1, approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [userId, entryId]
    );
    
    // Alocar automaticamente
    await allocatePayroll(pool, entryId);
    
    const [updated] = await pool.query('SELECT * FROM payroll_entries WHERE id = ?', [entryId]);
    
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error approving payroll entry:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Dashboard financeiro
 */
export async function getFinancialDashboard(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    const startDate = req.query.start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDate = req.query.end_date || new Date().toISOString().split('T')[0];
    
    // Custo estimado = material + mão de obra + overhead (schema schema-financial-engine.sql)
    let revenueCost = [{}];
    try {
      const [rows] = await pool.query(
        `SELECT 
         SUM(estimated_revenue) as estimated_revenue,
         SUM(actual_revenue) as actual_revenue,
         SUM(COALESCE(estimated_material_cost,0) + COALESCE(estimated_labor_cost,0) + COALESCE(estimated_overhead,0)) as estimated_cost,
         SUM(actual_total_cost) as actual_cost,
         SUM(estimated_profit) as estimated_profit,
         SUM(actual_profit) as actual_profit
       FROM project_financials
       WHERE created_at BETWEEN ? AND ?`,
        [startDate, endDate]
      );
      revenueCost = rows;
    } catch (e) {
      console.warn('getFinancialDashboard revenue_vs_cost:', e.message);
    }

    let expenseBreakdown = [];
    try {
      const [rows] = await pool.query(
        `SELECT category, SUM(total_amount) as total
       FROM expenses
       WHERE status IN ('approved', 'paid') AND expense_date BETWEEN ? AND ?
       GROUP BY category
       ORDER BY total DESC`,
        [startDate, endDate]
      );
      expenseBreakdown = rows;
    } catch (e) {
      console.warn('getFinancialDashboard expense_breakdown:', e.message);
    }

    let cashFlow = [];
    try {
      const [rows] = await pool.query(
        `SELECT 
         DATE_FORMAT(expense_date, '%Y-%m') as month,
         SUM(total_amount) as expenses,
         (SELECT SUM(actual_revenue) FROM project_financials 
          WHERE DATE_FORMAT(updated_at, '%Y-%m') = DATE_FORMAT(expenses.expense_date, '%Y-%m')) as revenue
       FROM expenses
       WHERE status IN ('approved', 'paid') AND expense_date BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
       ORDER BY month`,
        [startDate, endDate]
      );
      cashFlow = rows;
    } catch (e) {
      console.warn('getFinancialDashboard monthly_cash_flow:', e.message);
    }

    let profitabilityRanking = [];
    try {
      const [rows] = await pool.query(
        `SELECT 
         pf.project_id,
         p.project_number,
         pf.actual_profit,
         pf.actual_margin_percentage,
         pf.profit_variance
       FROM project_financials pf
       JOIN projects p ON pf.project_id = p.id
       WHERE pf.actual_profit IS NOT NULL
       ORDER BY pf.actual_profit DESC
       LIMIT 10`
      );
      profitabilityRanking = rows;
    } catch (e) {
      console.warn('getFinancialDashboard profitability_ranking:', e.message);
    }

    let crewCosts = [];
    try {
      const [rows] = await pool.query(
        `SELECT 
         c.id as crew_id,
         c.name as crew_name,
         SUM(pe.total_cost + pe.overtime_cost) as total_cost,
         SUM(pe.hours_worked + pe.overtime_hours) as total_hours
       FROM payroll_entries pe
       JOIN crews c ON pe.crew_id = c.id
       WHERE pe.approved = 1 AND pe.date BETWEEN ? AND ?
       GROUP BY c.id, c.name
       ORDER BY total_cost DESC`,
        [startDate, endDate]
      );
      crewCosts = rows;
    } catch (e) {
      console.warn('getFinancialDashboard crew_cost_analysis:', e.message);
    }

    return res.json({
      success: true,
      data: {
        revenue_vs_cost: revenueCost[0] || {},
        expense_breakdown: expenseBreakdown,
        monthly_cash_flow: cashFlow,
        profitability_ranking: profitabilityRanking,
        crew_cost_analysis: crewCosts,
      },
    });
  } catch (error) {
    console.error('Error getting financial dashboard:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
