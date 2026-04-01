/**
 * Construction payroll v2 — employees, periods, timesheets, reports.
 */
import { getDBConnection } from '../config/db.js';
import { calcTimesheetLineAmount } from '../modules/payroll/constructionPayrollCalc.js';

function isMissingTable(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || String(err.message || '').includes('doesn\'t exist'));
}

function sendDbError(res, err) {
  if (isMissingTable(err)) {
    return res.status(503).json({
      success: false,
      error: 'Tabelas de payroll não encontradas. Execute: npm run migrate:construction-payroll',
      code: 'PAYROLL_SCHEMA_MISSING',
    });
  }
  console.error('[construction-payroll]', err);
  return res.status(500).json({ success: false, error: err.message || String(err) });
}

async function loadPeriod(pool, id) {
  const [rows] = await pool.query('SELECT * FROM construction_payroll_periods WHERE id = ?', [id]);
  return rows[0] || null;
}

async function assertPeriodWritable(pool, periodId) {
  const p = await loadPeriod(pool, periodId);
  if (!p) {
    const e = new Error('Período não encontrado');
    e.statusCode = 404;
    throw e;
  }
  if (p.status === 'closed') {
    const e = new Error('Período fechado — edição bloqueada.');
    e.statusCode = 409;
    throw e;
  }
  return p;
}

function workDateInPeriod(workDate, start, end) {
  const w = String(workDate);
  return w >= String(start).slice(0, 10) && w <= String(end).slice(0, 10);
}

async function loadEmployee(pool, id) {
  const [rows] = await pool.query('SELECT * FROM construction_payroll_employees WHERE id = ?', [id]);
  return rows[0] || null;
}

/** @param {unknown} v */
function normalizeSector(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).toLowerCase().replace(/-/g, '_');
  if (s === 'installation') return 'installation';
  if (s === 'sand_finish' || s === 'sandandfinish' || s === 'sand and finish') return 'sand_finish';
  return null;
}

/** @param {import('express').Request} req @param {import('express').Response} res */
export async function getPayrollDashboard(req, res) {
  try {
    const pool = await getDBConnection();
    const [[empRow]] = await pool.query(
      'SELECT COUNT(*) AS c FROM construction_payroll_employees WHERE is_active = 1'
    );
    const [[openRow]] = await pool.query(
      "SELECT COUNT(*) AS c FROM construction_payroll_periods WHERE status = 'open'"
    );
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const from = startOfMonth.toISOString().slice(0, 10);
    const [[mtdRow]] = await pool.query(
      `SELECT COALESCE(SUM(calculated_amount),0) AS total FROM construction_payroll_timesheets WHERE work_date >= ?`,
      [from]
    );
    const [lastClosed] = await pool.query(
      `SELECT p.id, p.name, p.end_date, COALESCE(SUM(t.calculated_amount),0) AS total
       FROM construction_payroll_periods p
       LEFT JOIN construction_payroll_timesheets t ON t.period_id = p.id
       WHERE p.status = 'closed'
       GROUP BY p.id, p.name, p.end_date
       ORDER BY p.end_date DESC
       LIMIT 1`
    );
    return res.json({
      success: true,
      data: {
        active_employees: Number(empRow.c) || 0,
        open_periods: Number(openRow.c) || 0,
        month_to_date_payroll_total: Number(mtdRow.total) || 0,
        last_closed_period: lastClosed[0] || null,
      },
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function listEmployees(req, res) {
  try {
    const pool = await getDBConnection();
    const activeOnly =
      req.query.active !== '0' && req.query.active !== 'false' && req.query.active !== 'all';
    let q = 'SELECT * FROM construction_payroll_employees';
    const params = [];
    if (activeOnly) {
      q += ' WHERE is_active = 1';
    }
    q += ' ORDER BY name ASC';
    const [rows] = await pool.query(q, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function getEmployee(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const row = await loadEmployee(pool, id);
    if (!row) return res.status(404).json({ success: false, error: 'Não encontrado' });
    return res.json({ success: true, data: row });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function createEmployee(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    const sector = normalizeSector(b.sector);
    const baseParams = [
      String(b.name || '').trim() || 'Sem nome',
      b.role != null ? String(b.role) : null,
      b.phone != null ? String(b.phone) : null,
      b.email != null ? String(b.email) : null,
      ['daily', 'hourly', 'mixed'].includes(b.payment_type) ? b.payment_type : 'daily',
      Number(b.daily_rate) || 0,
      Number(b.hourly_rate) || 0,
      Number(b.overtime_rate) || 0,
      b.payment_method != null ? String(b.payment_method) : null,
      b.user_id != null && b.user_id !== '' ? parseInt(b.user_id, 10) : null,
      b.is_active === false || b.is_active === 0 ? 0 : 1,
    ];
    let r;
    try {
      const params = [...baseParams.slice(0, 9), sector, baseParams[9], baseParams[10]];
      [r] = await pool.execute(
        `INSERT INTO construction_payroll_employees
         (name, role, phone, email, payment_type, daily_rate, hourly_rate, overtime_rate, payment_method, sector, user_id, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      );
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
        [r] = await pool.execute(
          `INSERT INTO construction_payroll_employees
           (name, role, phone, email, payment_type, daily_rate, hourly_rate, overtime_rate, payment_method, user_id, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          baseParams
        );
      } else {
        throw e;
      }
    }
    const [rows] = await pool.query('SELECT * FROM construction_payroll_employees WHERE id = ?', [r.insertId]);
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function updateEmployee(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const existing = await loadEmployee(pool, id);
    if (!existing) return res.status(404).json({ success: false, error: 'Não encontrado' });
    const b = req.body || {};
    const params = [
      b.name != null ? String(b.name).trim() : null,
      b.role !== undefined ? b.role : existing.role,
      b.phone !== undefined ? b.phone : existing.phone,
      b.email !== undefined ? b.email : existing.email,
      b.payment_type != null && ['daily', 'hourly', 'mixed'].includes(b.payment_type) ? b.payment_type : null,
      b.daily_rate != null ? Number(b.daily_rate) : null,
      b.hourly_rate != null ? Number(b.hourly_rate) : null,
      b.overtime_rate != null ? Number(b.overtime_rate) : null,
      b.payment_method !== undefined ? b.payment_method : existing.payment_method,
      b.sector !== undefined ? normalizeSector(b.sector) : existing.sector,
      b.user_id !== undefined ? (b.user_id === '' || b.user_id == null ? null : parseInt(b.user_id, 10)) : existing.user_id,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : null,
      id,
    ];
    try {
      await pool.execute(
        `UPDATE construction_payroll_employees SET
          name = COALESCE(?, name),
          role = ?,
          phone = ?,
          email = ?,
          payment_type = COALESCE(?, payment_type),
          daily_rate = COALESCE(?, daily_rate),
          hourly_rate = COALESCE(?, hourly_rate),
          overtime_rate = COALESCE(?, overtime_rate),
          payment_method = ?,
          sector = ?,
          user_id = ?,
          is_active = COALESCE(?, is_active)
         WHERE id = ?`,
        params
      );
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
        await pool.execute(
          `UPDATE construction_payroll_employees SET
            name = COALESCE(?, name),
            role = ?,
            phone = ?,
            email = ?,
            payment_type = COALESCE(?, payment_type),
            daily_rate = COALESCE(?, daily_rate),
            hourly_rate = COALESCE(?, hourly_rate),
            overtime_rate = COALESCE(?, overtime_rate),
            payment_method = ?,
            user_id = ?,
            is_active = COALESCE(?, is_active)
           WHERE id = ?`,
          [
            params[0],
            params[1],
            params[2],
            params[3],
            params[4],
            params[5],
            params[6],
            params[7],
            params[8],
            params[10],
            params[11],
            params[12],
          ]
        );
      } else {
        throw e;
      }
    }
    const row = await loadEmployee(pool, id);
    return res.json({ success: true, data: row });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function listPeriods(req, res) {
  try {
    const pool = await getDBConnection();
    let rows;
    try {
      const [r] = await pool.query(
        `SELECT p.*,
          (SELECT COUNT(*) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS line_count,
          (SELECT COALESCE(SUM(calculated_amount),0) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS total_amount,
          (SELECT COALESCE(SUM(a.reimbursement),0) FROM construction_payroll_period_adjustments a WHERE a.period_id = p.id) AS reimbursement_total
         FROM construction_payroll_periods p
         ORDER BY p.start_date DESC, p.id DESC`
      );
      rows = r;
    } catch (e) {
      if (isMissingTable(e) && String(e.message || '').includes('construction_payroll_period_adjustments')) {
        const [r] = await pool.query(
          `SELECT p.*,
            (SELECT COUNT(*) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS line_count,
            (SELECT COALESCE(SUM(calculated_amount),0) FROM construction_payroll_timesheets t WHERE t.period_id = p.id) AS total_amount
           FROM construction_payroll_periods p
           ORDER BY p.start_date DESC, p.id DESC`
        );
        rows = (r || []).map((x) => ({ ...x, reimbursement_total: 0 }));
      } else {
        throw e;
      }
    }
    return res.json({ success: true, data: rows });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function getPeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const p = await loadPeriod(pool, id);
    if (!p) return res.status(404).json({ success: false, error: 'Não encontrado' });
    const [[agg]] = await pool.query(
      `SELECT COUNT(*) AS line_count, COALESCE(SUM(calculated_amount),0) AS total_amount
       FROM construction_payroll_timesheets WHERE period_id = ?`,
      [id]
    );
    let reimbursement_total = 0;
    try {
      const [[r]] = await pool.query(
        'SELECT COALESCE(SUM(reimbursement),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
        [id]
      );
      reimbursement_total = Number(r.s) || 0;
    } catch (_) {
      /* tabela opcional até migrate */
    }
    return res.json({
      success: true,
      data: { ...p, ...agg, reimbursement_total },
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function createPeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    const name = String(b.name || '').trim() || 'Período';
    const frequency = ['weekly', 'biweekly', 'monthly'].includes(b.frequency) ? b.frequency : 'biweekly';
    const start_date = b.start_date;
    const end_date = b.end_date;
    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, error: 'start_date e end_date são obrigatórios' });
    }
    const [r] = await pool.execute(
      `INSERT INTO construction_payroll_periods (name, frequency, start_date, end_date, status)
       VALUES (?, ?, ?, ?, 'open')`,
      [name, frequency, start_date, end_date]
    );
    const p = await loadPeriod(pool, r.insertId);
    return res.status(201).json({ success: true, data: p });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function updatePeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const p = await assertPeriodWritable(pool, id);
    const b = req.body || {};
    const sd = b.start_date != null ? b.start_date : p.start_date;
    const ed = b.end_date != null ? b.end_date : p.end_date;
    if (String(sd) > String(ed)) {
      return res.status(400).json({ success: false, error: 'Datas do período inválidas' });
    }
    await pool.execute(
      `UPDATE construction_payroll_periods SET
        name = COALESCE(?, name),
        frequency = COALESCE(?, frequency),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date)
       WHERE id = ?`,
      [
        b.name != null ? String(b.name).trim() : null,
        b.frequency != null && ['weekly', 'biweekly', 'monthly'].includes(b.frequency) ? b.frequency : null,
        b.start_date != null ? b.start_date : null,
        b.end_date != null ? b.end_date : null,
        id,
      ]
    );
    return res.json({ success: true, data: await loadPeriod(pool, id) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    return sendDbError(res, err);
  }
}

export async function closePeriod(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const p = await loadPeriod(pool, id);
    if (!p) return res.status(404).json({ success: false, error: 'Não encontrado' });
    if (p.status === 'closed') {
      return res.status(409).json({ success: false, error: 'Período já fechado' });
    }
    const uid = req.session.userId || null;
    await pool.execute(
      `UPDATE construction_payroll_periods SET status = 'closed', closed_at = NOW(), closed_by = ? WHERE id = ?`,
      [uid, id]
    );
    return res.json({ success: true, data: await loadPeriod(pool, id) });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function getPeriodPreview(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const p = await loadPeriod(pool, id);
    if (!p) return res.status(404).json({ success: false, error: 'Não encontrado' });

    let byEmpTs = [];
    try {
      const [rows] = await pool.query(
        `SELECT e.id AS employee_id, e.name, e.payment_type, e.sector,
          COUNT(t.id) AS line_count,
          COALESCE(SUM(t.calculated_amount),0) AS subtotal
         FROM construction_payroll_timesheets t
         INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
         WHERE t.period_id = ?
         GROUP BY e.id, e.name, e.payment_type, e.sector
         ORDER BY e.name`,
        [id]
      );
      byEmpTs = rows || [];
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
        const [rows] = await pool.query(
          `SELECT e.id AS employee_id, e.name, e.payment_type,
            COUNT(t.id) AS line_count,
            COALESCE(SUM(t.calculated_amount),0) AS subtotal
           FROM construction_payroll_timesheets t
           INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
           WHERE t.period_id = ?
           GROUP BY e.id, e.name, e.payment_type
           ORDER BY e.name`,
          [id]
        );
        byEmpTs = (rows || []).map((r) => ({ ...r, sector: null }));
      } else {
        throw e;
      }
    }

    let adjRows = [];
    try {
      const [ar] = await pool.query(
        'SELECT employee_id, reimbursement, notes FROM construction_payroll_period_adjustments WHERE period_id = ?',
        [id]
      );
      adjRows = ar || [];
    } catch (_) {
      adjRows = [];
    }

    const adjMap = new Map(adjRows.map((r) => [r.employee_id, r]));
    const seen = new Set();
    const by_employee = [];

    for (const row of byEmpTs) {
      seen.add(row.employee_id);
      const adj = adjMap.get(row.employee_id);
      const reim = adj ? Number(adj.reimbursement) || 0 : 0;
      const sub = Number(row.subtotal) || 0;
      by_employee.push({
        employee_id: row.employee_id,
        name: row.name,
        payment_type: row.payment_type,
        sector: row.sector,
        line_count: Number(row.line_count) || 0,
        subtotal: sub,
        reimbursement: reim,
        reimbursement_notes: adj?.notes || null,
        employee_total: Math.round((sub + reim) * 100) / 100,
      });
    }

    for (const adj of adjRows) {
      if (seen.has(adj.employee_id)) continue;
      const emp = await loadEmployee(pool, adj.employee_id);
      if (!emp) continue;
      const reim = Number(adj.reimbursement) || 0;
      by_employee.push({
        employee_id: adj.employee_id,
        name: emp.name,
        payment_type: emp.payment_type,
        sector: emp.sector,
        line_count: 0,
        subtotal: 0,
        reimbursement: reim,
        reimbursement_notes: adj.notes || null,
        employee_total: Math.round(reim * 100) / 100,
      });
    }

    by_employee.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const [[grandTs]] = await pool.query(
      'SELECT COALESCE(SUM(calculated_amount),0) AS s FROM construction_payroll_timesheets WHERE period_id = ?',
      [id]
    );
    let grandReim = 0;
    try {
      const [[gr]] = await pool.query(
        'SELECT COALESCE(SUM(reimbursement),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
        [id]
      );
      grandReim = Number(gr.s) || 0;
    } catch (_) {}

    const grand_timesheet = Number(grandTs.s) || 0;
    const grand_total = Math.round((grand_timesheet + grandReim) * 100) / 100;

    return res.json({
      success: true,
      data: {
        period: p,
        by_employee,
        grand_timesheet,
        grand_reimbursement: grandReim,
        grand_total,
      },
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function putPeriodAdjustments(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.id, 10);
    await assertPeriodWritable(pool, periodId);
    const list = req.body?.adjustments;
    if (!Array.isArray(list)) {
      return res.status(400).json({ success: false, error: 'Body.adjustments deve ser um array' });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM construction_payroll_period_adjustments WHERE period_id = ?', [periodId]);
      for (const r of list) {
        if (!r || typeof r !== 'object') continue;
        const eid = parseInt(r.employee_id, 10);
        if (!eid) continue;
        const emp = await loadEmployee(conn, eid);
        if (!emp) continue;
        const amt = Math.round((Number(r.reimbursement) || 0) * 100) / 100;
        const notes = r.notes != null ? String(r.notes).slice(0, 500) : null;
        if (amt === 0 && (!notes || notes === '')) continue;
        await conn.execute(
          `INSERT INTO construction_payroll_period_adjustments (period_id, employee_id, reimbursement, notes)
           VALUES (?,?,?,?)`,
          [periodId, eid, amt, notes]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    return res.json({ success: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    return sendDbError(res, err);
  }
}

export async function listTimesheets(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.periodId, 10);
    const p = await loadPeriod(pool, periodId);
    if (!p) return res.status(404).json({ success: false, error: 'Período não encontrado' });
    let q = `SELECT t.*, e.name AS employee_name, e.payment_type AS employee_payment_type, e.sector AS employee_sector,
              pr.project_number, pr.status AS project_status
       FROM construction_payroll_timesheets t
       INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
       LEFT JOIN projects pr ON pr.id = t.project_id
       WHERE t.period_id = ?`;
    const params = [periodId];
    if (req.query.employee_id) {
      q += ' AND t.employee_id = ?';
      params.push(parseInt(req.query.employee_id, 10));
    }
    if (req.query.project_id) {
      q += ' AND t.project_id = ?';
      params.push(parseInt(req.query.project_id, 10));
    }
    q += ' ORDER BY t.work_date ASC, t.id ASC';
    let rows;
    try {
      const [r] = await pool.query(q, params);
      rows = r;
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector')) {
        const q2 = q.replace('e.payment_type AS employee_payment_type, e.sector AS employee_sector,', 'e.payment_type AS employee_payment_type,');
        const [r] = await pool.query(q2, params);
        rows = (r || []).map((x) => ({ ...x, employee_sector: null }));
      } else {
        throw e;
      }
    }
    return res.json({ success: true, data: rows, period: p });
  } catch (err) {
    return sendDbError(res, err);
  }
}

async function upsertOneLine(pool, period, line, userId) {
  const employeeId = parseInt(line.employee_id, 10);
  const emp = await loadEmployee(pool, employeeId);
  if (!emp || !emp.is_active) {
    const e = new Error('Funcionário inválido ou inativo');
    e.statusCode = 400;
    throw e;
  }
  const workDate = line.work_date;
  if (!workDate || !workDateInPeriod(workDate, period.start_date, period.end_date)) {
    const e = new Error('Data fora do período');
    e.statusCode = 400;
    throw e;
  }
  let projectId = line.project_id != null && line.project_id !== '' ? parseInt(line.project_id, 10) : null;
  if (projectId) {
    const [pr] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (!pr.length) {
      const e = new Error('Projeto não encontrado');
      e.statusCode = 400;
      throw e;
    }
  }
  const days_worked = Number(line.days_worked) || 0;
  const regular_hours = Number(line.regular_hours) || 0;
  const overtime_hours = Number(line.overtime_hours) || 0;
  const notes = line.notes != null ? String(line.notes) : null;
  const calculated_amount = calcTimesheetLineAmount(emp, {
    days_worked,
    regular_hours,
    overtime_hours,
  });

  const payload = [
    period.id,
    employeeId,
    projectId,
    workDate,
    days_worked,
    regular_hours,
    overtime_hours,
    notes,
    calculated_amount,
    userId,
  ];

  if (line.id) {
    const tid = parseInt(line.id, 10);
    const [existing] = await pool.query(
      'SELECT t.id, p.status FROM construction_payroll_timesheets t JOIN construction_payroll_periods p ON p.id = t.period_id WHERE t.id = ?',
      [tid]
    );
    if (!existing.length) {
      const e = new Error('Linha não encontrada');
      e.statusCode = 404;
      throw e;
    }
    if (existing[0].status === 'closed') {
      const e = new Error('Período fechado');
      e.statusCode = 409;
      throw e;
    }
    await pool.execute(
      `UPDATE construction_payroll_timesheets SET
        employee_id = ?, project_id = ?, work_date = ?, days_worked = ?, regular_hours = ?, overtime_hours = ?,
        notes = ?, calculated_amount = ?
       WHERE id = ? AND period_id = ?`,
      [
        employeeId,
        projectId,
        workDate,
        days_worked,
        regular_hours,
        overtime_hours,
        notes,
        calculated_amount,
        tid,
        period.id,
      ]
    );
    const [rows] = await pool.query(
      `SELECT t.*, e.name AS employee_name FROM construction_payroll_timesheets t
       INNER JOIN construction_payroll_employees e ON e.id = t.employee_id WHERE t.id = ?`,
      [tid]
    );
    return rows[0];
  }

  const [ins] = await pool.execute(
    `INSERT INTO construction_payroll_timesheets
     (period_id, employee_id, project_id, work_date, days_worked, regular_hours, overtime_hours, notes, calculated_amount, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    payload
  );
  const [rows] = await pool.query(
    `SELECT t.*, e.name AS employee_name FROM construction_payroll_timesheets t
     INNER JOIN construction_payroll_employees e ON e.id = t.employee_id WHERE t.id = ?`,
    [ins.insertId]
  );
  return rows[0];
}

export async function bulkTimesheets(req, res) {
  try {
    const pool = await getDBConnection();
    const periodId = parseInt(req.params.periodId, 10);
    const period = await assertPeriodWritable(pool, periodId);
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const uid = req.session.userId || null;
    const out = [];
    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;
      if (!line.id && (!line.employee_id || !line.work_date)) continue;
      try {
        const row = await upsertOneLine(pool, period, line, uid);
        out.push(row);
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
          e.statusCode = 409;
          e.message = 'Já existe linha para este funcionário, projeto e data neste período';
        }
        throw e;
      }
    }
    return res.json({ success: true, data: out });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    return sendDbError(res, err);
  }
}

export async function updateTimesheet(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const [existing] = await pool.query(
      `SELECT t.*, p.status, p.start_date, p.end_date FROM construction_payroll_timesheets t
       JOIN construction_payroll_periods p ON p.id = t.period_id WHERE t.id = ?`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ success: false, error: 'Não encontrado' });
    const row0 = existing[0];
    if (row0.status === 'closed') {
      return res.status(409).json({ success: false, error: 'Período fechado' });
    }
    const period = {
      id: row0.period_id,
      start_date: row0.start_date,
      end_date: row0.end_date,
    };
    const b = req.body || {};
    const merged = {
      id,
      employee_id: b.employee_id != null ? b.employee_id : row0.employee_id,
      project_id: b.project_id !== undefined ? b.project_id : row0.project_id,
      work_date: b.work_date != null ? b.work_date : row0.work_date,
      days_worked: b.days_worked != null ? b.days_worked : row0.days_worked,
      regular_hours: b.regular_hours != null ? b.regular_hours : row0.regular_hours,
      overtime_hours: b.overtime_hours != null ? b.overtime_hours : row0.overtime_hours,
      notes: b.notes !== undefined ? b.notes : row0.notes,
    };
    const uid = req.session.userId || null;
    const updated = await upsertOneLine(pool, period, merged, uid);
    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    return sendDbError(res, err);
  }
}

export async function deleteTimesheet(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const [existing] = await pool.query(
      `SELECT t.id, p.status FROM construction_payroll_timesheets t
       JOIN construction_payroll_periods p ON p.id = t.period_id WHERE t.id = ?`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ success: false, error: 'Não encontrado' });
    if (existing[0].status === 'closed') {
      return res.status(409).json({ success: false, error: 'Período fechado' });
    }
    await pool.execute('DELETE FROM construction_payroll_timesheets WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function reportEmployeeEarnings(req, res) {
  try {
    const pool = await getDBConnection();
    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'Parâmetros from e to (YYYY-MM-DD) são obrigatórios' });
    }
    let rows;
    try {
      const [r] = await pool.query(
        `SELECT e.id AS employee_id, e.name, e.role, e.sector,
          COUNT(t.id) AS entries,
          COALESCE(SUM(t.days_worked),0) AS total_days,
          COALESCE(SUM(t.regular_hours),0) AS total_regular_hours,
          COALESCE(SUM(t.overtime_hours),0) AS total_overtime_hours,
          COALESCE(SUM(t.calculated_amount),0) AS timesheet_earnings,
          COALESCE((
            SELECT SUM(a.reimbursement) FROM construction_payroll_period_adjustments a
            INNER JOIN construction_payroll_periods p ON p.id = a.period_id
            WHERE a.employee_id = e.id AND p.end_date >= ? AND p.end_date <= ?
          ), 0) AS reimbursement_total,
          COALESCE(SUM(t.calculated_amount),0) + COALESCE((
            SELECT SUM(a.reimbursement) FROM construction_payroll_period_adjustments a
            INNER JOIN construction_payroll_periods p ON p.id = a.period_id
            WHERE a.employee_id = e.id AND p.end_date >= ? AND p.end_date <= ?
          ), 0) AS total_earnings
         FROM construction_payroll_timesheets t
         INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
         WHERE t.work_date >= ? AND t.work_date <= ?
         GROUP BY e.id, e.name, e.role, e.sector
         ORDER BY total_earnings DESC`,
        [from, to, from, to, from, to]
      );
      rows = r;
    } catch (e) {
      if (
        isMissingTable(e) ||
        (e.code === 'ER_BAD_FIELD_ERROR' && String(e.message || '').includes('sector'))
      ) {
        const [r] = await pool.query(
          `SELECT e.id AS employee_id, e.name, e.role,
            COUNT(t.id) AS entries,
            COALESCE(SUM(t.days_worked),0) AS total_days,
            COALESCE(SUM(t.regular_hours),0) AS total_regular_hours,
            COALESCE(SUM(t.overtime_hours),0) AS total_overtime_hours,
            COALESCE(SUM(t.calculated_amount),0) AS timesheet_earnings,
            0 AS reimbursement_total,
            COALESCE(SUM(t.calculated_amount),0) AS total_earnings
           FROM construction_payroll_timesheets t
           INNER JOIN construction_payroll_employees e ON e.id = t.employee_id
           WHERE t.work_date >= ? AND t.work_date <= ?
           GROUP BY e.id, e.name, e.role
           ORDER BY total_earnings DESC`,
          [from, to]
        );
        rows = (r || []).map((x) => ({ ...x, sector: null }));
      } else {
        throw e;
      }
    }
    return res.json({ success: true, data: rows, range: { from, to } });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function reportProjectLabor(req, res) {
  try {
    const pool = await getDBConnection();
    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'Parâmetros from e to são obrigatórios' });
    }
    const [rows] = await pool.query(
      `SELECT t.project_id, pr.project_number,
        COUNT(t.id) AS entries,
        COALESCE(SUM(t.calculated_amount),0) AS labor_cost
       FROM construction_payroll_timesheets t
       LEFT JOIN projects pr ON pr.id = t.project_id
       WHERE t.work_date >= ? AND t.work_date <= ?
       GROUP BY t.project_id, pr.project_number
       ORDER BY labor_cost DESC`,
      [from, to]
    );
    return res.json({ success: true, data: rows, range: { from, to } });
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function reportTotalExpenses(req, res) {
  try {
    const pool = await getDBConnection();
    if (req.query.period_id) {
      const pid = parseInt(req.query.period_id, 10);
      const p = await loadPeriod(pool, pid);
      if (!p) return res.status(404).json({ success: false, error: 'Período não encontrado' });
      const [[agg]] = await pool.query(
        'SELECT COALESCE(SUM(calculated_amount),0) AS total, COUNT(*) AS lines FROM construction_payroll_timesheets WHERE period_id = ?',
        [pid]
      );
      let reim = 0;
      try {
        const [[r]] = await pool.query(
          'SELECT COALESCE(SUM(reimbursement),0) AS s FROM construction_payroll_period_adjustments WHERE period_id = ?',
          [pid]
        );
        reim = Number(r.s) || 0;
      } catch (_) {}
      const labor = Number(agg.total) || 0;
      return res.json({
        success: true,
        data: {
          scope: 'period',
          period: p,
          timesheet_total: labor,
          reimbursement_total: reim,
          total: Math.round((labor + reim) * 100) / 100,
          line_count: Number(agg.lines) || 0,
        },
      });
    }
    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'Informe period_id ou from e to',
      });
    }
    const [[agg]] = await pool.query(
      'SELECT COALESCE(SUM(calculated_amount),0) AS total, COUNT(*) AS lines FROM construction_payroll_timesheets WHERE work_date >= ? AND work_date <= ?',
      [from, to]
    );
    let reimRange = 0;
    try {
      const [[r]] = await pool.query(
        `SELECT COALESCE(SUM(a.reimbursement),0) AS s
         FROM construction_payroll_period_adjustments a
         INNER JOIN construction_payroll_periods p ON p.id = a.period_id
         WHERE p.end_date >= ? AND p.end_date <= ?`,
        [from, to]
      );
      reimRange = Number(r.s) || 0;
    } catch (_) {}
    const labor = Number(agg.total) || 0;
    return res.json({
      success: true,
      data: {
        scope: 'range',
        timesheet_total: labor,
        reimbursement_total: reimRange,
        total: Math.round((labor + reimRange) * 100) / 100,
        line_count: Number(agg.lines) || 0,
        range: { from, to },
      },
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}
