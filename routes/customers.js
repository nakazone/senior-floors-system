/**
 * Clients API — tabela `customers` (builders, clientes finais convertidos de leads).
 */
import { getDBConnection } from '../config/db.js';

export async function listCustomers(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const search = req.query.search || null;

    let whereClause = '1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const [rows] = await pool.query(
      `SELECT id, name, email, phone, city, state, zipcode, customer_type, owner_id, status, created_at 
       FROM customers 
       WHERE ${whereClause}
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM customers WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { name, email, phone, address, city, state, zipcode, customer_type, owner_id, notes } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Name, email, and phone are required' });
    }

    const [result] = await pool.execute(
      `INSERT INTO customers (name, email, phone, address, city, state, zipcode, customer_type, owner_id, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [name, email, phone, address || null, city || null, state || null, zipcode || null, 
       customer_type || 'residential', owner_id || null, notes || null]
    );

    res.status(201).json({ success: true, data: { id: result.insertId }, message: 'Client created' });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateCustomer(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { name, email, phone, address, city, state, zipcode, customer_type, owner_id, status, notes } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (address !== undefined) { updates.push('address = ?'); values.push(address); }
    if (city !== undefined) { updates.push('city = ?'); values.push(city); }
    if (state !== undefined) { updates.push('state = ?'); values.push(state); }
    if (zipcode !== undefined) { updates.push('zipcode = ?'); values.push(zipcode); }
    if (customer_type !== undefined) { updates.push('customer_type = ?'); values.push(customer_type); }
    if (owner_id !== undefined) { updates.push('owner_id = ?'); values.push(owner_id); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Client updated' });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
