/**
 * Builder portal authentication (JWT, separate from CRM session).
 */
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { getDBConnection } from '../config/db.js';
import { signBuilderToken } from '../lib/builderJwt.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' },
});

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

async function logAccess(pool, builderId, req, action) {
  try {
    await pool.execute(
      `INSERT INTO builder_access_log (builder_id, ip_address, user_agent, action) VALUES (?, ?, ?, ?)`,
      [builderId, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 500), action]
    );
  } catch (_) {
    /* ignore */
  }
}

export async function postLogin(req, res) {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const [rows] = await pool.query(
      `SELECT id, email, customer_id, portal_access, portal_password_hash, portal_blocked, status,
              first_name, last_name, company
       FROM builders WHERE LOWER(email) = ? LIMIT 1`,
      [email]
    );
    const b = rows[0];
    if (!b || !b.portal_access) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    if (b.portal_blocked || b.status === 'inactive') {
      return res.status(403).json({ success: false, error: 'Portal access disabled' });
    }
    if (!b.portal_password_hash) {
      return res.status(403).json({ success: false, error: 'Password not set. Contact Senior Floors.' });
    }
    const ok = await bcrypt.compare(password, b.portal_password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    await pool.execute('UPDATE builders SET last_login = NOW() WHERE id = ?', [b.id]);
    await logAccess(pool, b.id, req, 'login');

    const token = signBuilderToken({
      builderId: b.id,
      email: b.email,
      customerId: b.customer_id,
    });

    res.json({
      success: true,
      data: {
        token,
        builder: {
          id: b.id,
          email: b.email,
          first_name: b.first_name,
          last_name: b.last_name,
          company: b.company,
          customer_id: b.customer_id,
        },
      },
    });
  } catch (e) {
    console.error('builder login:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postLogout(req, res) {
  res.json({ success: true, message: 'Logged out' });
}

export async function getMe(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [rows] = await pool.query(
      `SELECT id, customer_id, first_name, last_name, email, phone, company, website, type, status,
              regions, avg_ticket, portal_access, last_login, created_at
       FROM builders WHERE id = ?`,
      [req.builderAuth.builderId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Builder not found' });
    const b = rows[0];
    if (b.regions && typeof b.regions === 'string') {
      try {
        b.regions = JSON.parse(b.regions);
      } catch {
        b.regions = [];
      }
    }
    delete b.portal_password_hash;
    res.json({ success: true, data: b });
  } catch (e) {
    console.error('builder me:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postChangePassword(req, res) {
  try {
    const current = String(req.body?.current_password || '');
    const next = String(req.body?.new_password || '');
    if (!current || next.length < 8) {
      return res.status(400).json({ success: false, error: 'Current password and new password (8+ chars) required' });
    }
    const pool = await getDBConnection();
    const [rows] = await pool.query('SELECT portal_password_hash FROM builders WHERE id = ?', [
      req.builderAuth.builderId,
    ]);
    if (!rows.length || !(await bcrypt.compare(current, rows[0].portal_password_hash))) {
      return res.status(401).json({ success: false, error: 'Current password incorrect' });
    }
    const hash = await bcrypt.hash(next, 10);
    await pool.execute('UPDATE builders SET portal_password_hash = ? WHERE id = ?', [
      hash,
      req.builderAuth.builderId,
    ]);
    res.json({ success: true, message: 'Password updated' });
  } catch (e) {
    console.error('builder change password:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderAuthRoutes(app) {
  app.post('/api/builder-auth/login', loginLimiter, postLogin);
  app.post('/api/builder-auth/logout', postLogout);
  app.get('/api/builder-auth/me', requireBuilderAuth, getMe);
  app.post('/api/builder-auth/change-password', requireBuilderAuth, postChangePassword);
}
