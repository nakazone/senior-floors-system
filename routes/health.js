/**
 * GET /api/health — liveness para Railway (sempre HTTP 200; BD degradada não derruba o check).
 */
import { getDBConnection } from '../config/db.js';

export async function getHealth(req, res) {
  const uptime = Math.round(process.uptime());
  const heapBytes = process.memoryUsage().heapUsed;
  const memory = Math.round((heapBytes / 1024 / 1024) * 100) / 100;

  let db = 'ok';
  try {
    const pool = await getDBConnection();
    if (!pool) {
      db = { error: true, message: 'Pool não disponível' };
    } else {
      await pool.query('SELECT 1');
      db = 'ok';
    }
  } catch (e) {
    db = { error: true, message: e && e.message ? e.message : String(e) };
  }

  const status = db === 'ok' ? 'ok' : 'degraded';

  res.status(200).json({
    status,
    uptime,
    memory,
    node: process.version,
    db,
    timestamp: new Date().toISOString(),
  });
}
