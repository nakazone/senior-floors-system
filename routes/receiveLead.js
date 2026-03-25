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

/** Primeiro valor não vazio entre chaves (planilha Meta / Apps Script usa cabeçalhos variados). */
function firstString(post, keys) {
  for (const k of keys) {
    if (post[k] === undefined || post[k] === null) continue;
    const v = String(post[k]).trim();
    if (v) return v;
  }
  return '';
}

function pickLeadFieldsFromPost(post) {
  const name =
    firstString(post, [
      'name',
      'full_name',
      'full name',
      'Full Name',
      'fullname',
      'Nome',
      'nome',
      'Name',
      'first_name',
      'firstname',
      'First Name',
    ]) ||
    [post.first_name, post.last_name]
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim())
      .join(' ')
      .trim() ||
    [post.firstName, post.lastName]
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim())
      .join(' ')
      .trim();
  const email = firstString(post, [
    'email',
    'email_address',
    'Email',
    'Email Address',
    'e-mail',
    'E-mail',
  ]);
  const phone = firstString(post, [
    'phone',
    'phone_number',
    'Phone',
    'Phone Number',
    'mobile',
    'Mobile',
    'tel',
    'Telefone',
  ]);
  const zipcode = firstString(post, [
    'zipcode',
    'zip',
    'zip_code',
    'Zip',
    'Zip code',
    'Postal Code',
    'postal_code',
    'postcode',
    'CEP',
  ]);
  const message = firstString(post, ['message', 'Message', 'notes', 'Comments', 'questions']);
  return { name, email, phone, zipcode, message };
}

export async function handleReceiveLead(req, res) {
  const post = parseBody(req);

  const sheetsSecret = (process.env.SHEETS_SYNC_SECRET || '').trim();
  const sheetsSyncHeader = (req.headers['x-sheets-sync'] || req.headers['X-Sheets-Sync'] || '').trim();
  const isSheetsSyncRequest = sheetsSyncHeader === '1';
  if (sheetsSecret && isSheetsSyncRequest) {
    const fromHeader = (req.headers['x-sheets-sync-secret'] || req.headers['X-Sheets-Sync-Secret'] || '').trim();
    const fromBody = String(post['sync-secret'] || '').trim();
    if ((fromHeader || fromBody) !== sheetsSecret) {
      res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      return res.status(401).json({
        success: false,
        errors: ['Unauthorized'],
        hint: 'X-Sheets-Sync-Secret header (ou body sync-secret) deve coincidir com SHEETS_SYNC_SECRET no Railway.',
        api_version: 'receive-lead-system',
      });
    }
  }

  const form_name = (post['form-name'] || post.formName || 'contact-form').trim();
  const picked = pickLeadFieldsFromPost(post);
  let name = picked.name || (post.name || '').trim();
  let phone = picked.phone || (post.phone || '').trim();
  let email = picked.email || (post.email || '').trim();
  let zipcode = picked.zipcode || (post.zipcode || '').trim();
  let message = picked.message || (post.message || '').trim();

  const isMetaForm = /meta/i.test(form_name) || form_name === 'meta-instant-form';
  const relaxZipForImport = isSheetsSyncRequest || isMetaForm;

  const errors = [];
  if (!name || name.length < 2) errors.push('Name is required');
  if (!phone) errors.push('Phone is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email is required');
  let zipClean = (zipcode || '').replace(/\D/g, '');
  if (!zipClean || zipClean.length < 5) {
    if (relaxZipForImport) {
      zipClean = '00000';
    } else {
      errors.push('Valid 5-digit US zip code is required');
    }
  } else {
    zipClean = zipClean.slice(0, 5);
  }
  if (errors.length > 0) {
    console.warn('[receive-lead] validation failed', {
      errors,
      form_name,
      isSheetsSyncRequest,
      nameLen: name.length,
      emailLen: email.length,
      phoneLen: phone.length,
      rawZipLen: (zipcode || '').length,
    });
    return res.status(400).json({ success: false, errors, api_version: 'receive-lead-system' });
  }

  name = name.slice(0, 255);
  phone = phone.slice(0, 50);
  email = email.slice(0, 255);
  zipcode = zipClean;
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
            let defaultPipelineId = 1;
            try {
              const [st] = await pool.execute(
                "SELECT id FROM pipeline_stages WHERE slug = 'lead_received' ORDER BY order_num ASC LIMIT 1"
              );
              if (st && st[0] && st[0].id != null) defaultPipelineId = st[0].id;
            } catch (_) {}
            let cols = 'name, email, phone, zipcode, message, source, form_type, status, priority, ip_address';
            let place = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
            const values = [name, email, phone, zipcode, message, source, form_name, 'lead_received', 'medium', ip_address];
            try {
              const [oc] = await pool.query("SHOW COLUMNS FROM leads LIKE 'owner_id'");
              if (oc && oc.length > 0) { cols += ', owner_id'; place += ', ?'; values.push(owner_id); }
            } catch (_) {}
            try {
              const [pc] = await pool.query("SHOW COLUMNS FROM leads LIKE 'pipeline_stage_id'");
              if (pc && pc.length > 0) { cols += ', pipeline_stage_id'; place += ', ?'; values.push(defaultPipelineId); }
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
