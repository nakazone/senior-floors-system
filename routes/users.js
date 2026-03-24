/**
 * Users API - User management
 */
import bcrypt from 'bcryptjs';
import { getDBConnection } from '../config/db.js';

/** Colunas seguras para listagem (sem password) — só as que existem na tabela */
function buildUserSelectColumns(columnNames) {
  const names = new Set(columnNames);
  const want = ['id', 'name', 'email', 'phone', 'role', 'is_active', 'active', 'created_at', 'updated_at', 'last_login', 'last_login_at'];
  const pick = want.filter((w) => names.has(w));
  return pick.length ? pick.join(', ') : 'id, name, email, role';
}

export async function listUsers(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const role = req.query.role || null;
    const active = req.query.active !== undefined ? req.query.active === 'true' : null;

    let whereClause = '1=1';
    const params = [];

    if (role) {
      whereClause += ' AND role = ?';
      params.push(role);
    }
    const [columns] = await pool.query('SHOW COLUMNS FROM users');
    const columnNames = columns.map((c) => c.Field);
    if (active !== null) {
      const activeField = columnNames.includes('is_active') ? 'is_active' : 'active';
      whereClause += ` AND ${activeField} = ?`;
      params.push(active ? 1 : 0);
    }

    const selectList = buildUserSelectColumns(columnNames);
    const orderCol = columnNames.includes('created_at') ? 'created_at' : 'id';

    const [rows] = await pool.query(
      `SELECT ${selectList}
       FROM users 
       WHERE ${whereClause}
       ORDER BY ${orderCol} DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM users WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getUser(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [colsForGet] = await pool.query('SHOW COLUMNS FROM users');
    const selectList = buildUserSelectColumns(colsForGet.map((c) => c.Field));
    const [rows] = await pool.query(`SELECT ${selectList} FROM users WHERE id = ?`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Não retornar senha
    const user = rows[0];
    delete user.password;
    delete user.password_hash;

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createUser(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { name, email, phone, role, password, is_active } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Name and email are required' });
    }

    // Verificar estrutura da tabela
    const [columns] = await pool.query(`SHOW COLUMNS FROM users`);
    const columnNames = columns.map(c => c.Field);
    const passwordField = columnNames.includes('password_hash') ? 'password_hash' : 'password';
    const activeField = columnNames.includes('is_active') ? 'is_active' : 'active';

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const insertCols = ['name', 'email', 'role', passwordField, activeField];
    const insertVals = [name, email, role || 'user', passwordHash, is_active !== undefined ? (is_active ? 1 : 0) : 1];
    if (columnNames.includes('phone')) {
      insertCols.splice(2, 0, 'phone');
      insertVals.splice(2, 0, phone || null);
    }

    const placeholders = insertCols.map(() => '?').join(', ');
    const [result] = await pool.execute(
      `INSERT INTO users (${insertCols.join(', ')}) VALUES (${placeholders})`,
      insertVals
    );

    res.status(201).json({ success: true, data: { id: result.insertId }, message: 'User created' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, error: 'Email already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateUser(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { name, email, phone, role, password, is_active } = req.body;

    // Verificar estrutura da tabela
    const [columns] = await pool.query(`SHOW COLUMNS FROM users`);
    const columnNames = columns.map(c => c.Field);
    const passwordField = columnNames.includes('password_hash') ? 'password_hash' : 'password';
    const activeField = columnNames.includes('is_active') ? 'is_active' : 'active';

    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined && columnNames.includes('phone')) {
      updates.push('phone = ?');
      values.push(phone);
    }
    if (role !== undefined) { updates.push('role = ?'); values.push(role); }
    if (is_active !== undefined) { updates.push(`${activeField} = ?`); values.push(is_active ? 1 : 0); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push(`${passwordField} = ?`);
      values.push(hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'User updated' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
