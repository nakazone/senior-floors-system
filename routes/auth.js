/**
 * Authentication routes - Login, Logout, Session
 */
import bcrypt from 'bcryptjs';
import { getDBConnection } from '../config/db.js';

/** Garante que o cookie de sessão é enviado antes da resposta JSON (evita 401 em PUT seguinte). */
function respondLoggedIn(req, res, userPayload, extra = {}) {
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).json({ success: false, error: 'Could not establish session' });
    }
    res.json({ success: true, user: userPayload, ...extra });
  });
}

export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }

  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    // Buscar usuário (detectar qual coluna de senha existe)
    // Primeiro verificar estrutura da tabela
    const [columns] = await pool.query(`SHOW COLUMNS FROM users`);
    const columnNames = columns.map(c => c.Field);
    const hasPasswordHash = columnNames.includes('password_hash');
    const hasPassword = columnNames.includes('password');
    const hasIsActive = columnNames.includes('is_active');
    const hasActive = columnNames.includes('active');
    
    const passwordField = hasPasswordHash ? 'password_hash' : (hasPassword ? 'password' : null);
    const activeField = hasIsActive ? 'is_active' : (hasActive ? 'active' : null);
    
    // Construir SELECT dinamicamente
    let selectFields = 'id, name, email';
    if (columnNames.includes('role')) selectFields += ', role';
    if (activeField) selectFields += `, ${activeField}`;
    if (passwordField) selectFields += `, ${passwordField}`;
    
    // Construir WHERE dinamicamente
    let whereClause = 'WHERE email = ?';
    if (activeField) {
      whereClause += ` AND ${activeField} = 1`;
    }
    
    const [users] = await pool.query(
      `SELECT ${selectFields}
       FROM users 
       ${whereClause}
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const user = users[0];
    const storedPassword = passwordField ? user[passwordField] : null;
    const userRole = user.role || 'user';

    if (!storedPassword) {
      // Usuário sem senha - permitir login se for admin (primeira vez)
      if (userRole === 'admin') {
        req.session.userId = user.id;
        req.session.userEmail = user.email;
        req.session.userRole = userRole;
        req.session.userName = user.name;
        
        return res.json({
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: userRole
          },
          message: 'Logged in (no password set - please set one)'
        });
      }
      return res.status(401).json({ success: false, error: 'Password not set for this user' });
    }

    // Verificar senha (bcrypt)
    const valid = await bcrypt.compare(password, storedPassword);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // Criar sessão
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userRole = userRole;
    req.session.userName = user.name;

    // Atualizar last_login (se coluna existir)
    try {
      if (columnNames.includes('last_login') || columnNames.includes('last_login_at')) {
        const lastLoginField = columnNames.includes('last_login_at') ? 'last_login_at' : 'last_login';
        await pool.query(
          `UPDATE users SET ${lastLoginField} = NOW() WHERE id = ?`,
          [user.id]
        );
      }
    } catch (e) {
      // Ignorar erro se coluna não existir
    }

    return respondLoggedIn(req, res, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: userRole,
    });
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

export async function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Could not logout' });
    }
    res.json({ success: true, message: 'Logged out' });
  });
}

export async function checkSession(req, res) {
  if (req.session.userId) {
    res.json({
      success: true,
      authenticated: true,
      user: {
        id: req.session.userId,
        email: req.session.userEmail,
        role: req.session.userRole,
        name: req.session.userName
      }
    });
  } else {
    res.json({
      success: true,
      authenticated: false
    });
  }
}
