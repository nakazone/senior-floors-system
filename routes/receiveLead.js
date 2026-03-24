/**
 * POST /api/receive-lead — save lead from LP (Vercel sends here)
 */
import { getDBConnection, isDatabaseConfigured } from '../config/db.js';
import { checkDuplicateLead, getNextOwnerRoundRobin } from '../lib/leadLogic.js';
import { notifyNewLead } from '../lib/leadPushNotify.js';
import { getLeadsTableColumns } from '../lib/leadColumns.js';
import { extractMarketingFromBody, MARKETING_KEYS } from '../lib/marketingLeadFields.js';

function parseBody(req) {
  const ct = (req.headers['content-type'] || '').toLowerCase();

  if (typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length > 0) {
    return req.body;
  }

  if (ct.includes('application/json')) {
    try {
      return JSON.parse(req.body || '{}');
    } catch (e) {
      return {};
    }
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    if (typeof req.body === 'string') {
      const params = new URLSearchParams(req.body);
      const result = {};
      for (const [key, value] of params.entries()) {
        result[key] = value;
      }
      return result;
    }
    return req.body || {};
  }

  return {};
}

export async function handleReceiveLead(req, res) {
  const post = parseBody(req);

  const sheetsSecret = (process.env.SHEETS_SYNC_SECRET || '').trim();
  const sheetsSyncHeader = (req.headers['x-sheets-sync'] || req.headers['X-Sheets-Sync'] || '').trim();
  if (sheetsSecret && sheetsSyncHeader === '1') {
    const fromHeader = (req.headers['x-sheets-sync-secret'] || req.headers['X-Sheets-Sync-Secret'] || '').trim();
    const fromBody = String(post['sync-secret'] || '').trim();
    if ((fromHeader || fromBody) !== sheetsSecret) {
      res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      return res.status(401).json({ success: false, errors: ['Unauthorized'], api_version: 'receive-lead-system' });
    }
  }

  const form_name = (post['form-name'] || post.formName || 'contact-form').trim();
  let name = (post.name || '').trim();
  let phone = (post.phone || '').trim();
  let email = (post.email || '').trim();
  let zipcode = (post.zipcode || '').trim();
  let message = (post.message || '').trim();

  const errors = [];
  if (!name || name.length < 2) errors.push('Name is required');
  if (!phone) errors.push('Phone is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email is required');
  const zipClean = (zipcode || '').replace(/\D/g, '');
  if (!zipClean || zipClean.length < 5) errors.push('Valid 5-digit US zip code is required');
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors, api_version: 'receive-lead-system' });
  }

  name = name.slice(0, 255);
  phone = phone.slice(0, 50);
  email = email.slice(0, 255);
  zipcode = zipClean.slice(0, 5);
  message = message.slice(0, 65535);

  let lead_id = null;
  let db_saved = false;
  let inserted_new = null;
  let db_error_reason = null;

  if (!isDatabaseConfigured()) {
    db_error_reason = 'Database not configured';
  } else {
    try {
      const pool = await getDBConnection();
      if (!pool) db_error_reason = 'Could not connect to database';
      else {
        const [tables] = await pool.query("SHOW TABLES LIKE 'leads'");
        if (!tables || tables.length === 0) db_error_reason = "Table 'leads' does not exist";
        else {
          let source = 'LP-Contact';
          if (form_name === 'hero-form') source = 'LP-Hero';
          else if (/meta/i.test(form_name) || form_name === 'meta-instant-form') source = 'Meta-Instant';
          const ip_address = req.ip || req.headers['x-forwarded-for'] || null;
          let owner_id = null;
          let is_dup = false;
          const phoneDigits = (phone || '').replace(/\D/g, '');
          const dup = await checkDuplicateLead(pool, email, phoneDigits, null);
          if (dup.is_duplicate) {
            is_dup = true;
            lead_id = dup.existing_id;
            db_saved = true;
            inserted_new = false;
          } else {
            owner_id = await getNextOwnerRoundRobin(pool);
          }
          if (!is_dup) {
            let cols = 'name, email, phone, zipcode, message, source, form_type, status, priority, ip_address';
            let place = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
            const values = [name, email, phone, zipcode, message, source, form_name, 'new', 'medium', ip_address];
            try {
              const [oc] = await pool.query("SHOW COLUMNS FROM leads LIKE 'owner_id'");
              if (oc && oc.length > 0) { cols += ', owner_id'; place += ', ?'; values.push(owner_id); }
            } catch (_) {}
            try {
              const [pc] = await pool.query("SHOW COLUMNS FROM leads LIKE 'pipeline_stage_id'");
              if (pc && pc.length > 0) { cols += ', pipeline_stage_id'; place += ', ?'; values.push(1); }
            } catch (_) {}
            const marketing = extractMarketingFromBody(post);
            const colSet = await getLeadsTableColumns(pool);
            for (const key of MARKETING_KEYS) {
              if (colSet.has(key)) {
                cols += `, \`${key}\``;
                place += ', ?';
                values.push(marketing[key]);
              }
            }
            const [result] = await pool.execute(`INSERT INTO leads (${cols}) VALUES (${place})`, values);
            lead_id = result.insertId;
            db_saved = true;
            inserted_new = true;
            notifyNewLead({
              name,
              email,
              phone,
              zipcode,
              source,
              leadId: lead_id,
              formName: form_name,
            }).catch(() => {});
          }
        }
      }
    } catch (e) {
      db_error_reason = e.message;
    }
  }

  const resp = {
    success: true,
    message: "Thank you! We'll contact you within 24 hours.",
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    lead_id,
    database_saved: db_saved,
    inserted_new,
    api_version: 'receive-lead-system',
    data: { form_type: form_name, name, email, phone, zipcode },
  };
  if (!db_saved) resp.db_error = db_error_reason || 'Unknown';
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.status(200).json(resp);
}
