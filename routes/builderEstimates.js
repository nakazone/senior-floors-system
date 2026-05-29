/**
 * Builder estimate requests, calculator, history, referrals (Sprint 4).
 */
import path from 'path';
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { generateEstimateRefNumber } from '../lib/estimateRefNumber.js';
import { uploadEstimateFiles } from '../lib/estimateMultiUpload.js';
import { sendBuilderNotification, adminNotifyEmail } from '../lib/builderNotify.js';
import { builderWantsEmail } from '../lib/builderNotifyPrefs.js';
import { notifyBuilder } from './builderNotifications.js';
import { getBuilderCustomerId, getProjectBuilderLinkMeta, buildProjectBuilderMatch, buildProjectOrderSql, buildProjectSelectSql, projectNotDeletedClause } from '../lib/builderProjectAccess.js';
import { getPartnerPricingForBuilder } from './builderPricing.js';
import { calculateLine } from '../lib/builderPricingCalc.js';
import { logEstimateEvent } from '../lib/builderActivityLog.js';
import { estimateStatusLabel, normalizeEstimateStatus } from '../lib/estimateRequestStatus.js';

async function tableExists(pool, name) {
 const [r] = await pool.query(
 `SELECT COUNT(*) AS c FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
 [name]
 );
 return Number(r[0]?.c) > 0;
}

async function columnExists(pool, table, col) {
 const [r] = await pool.query(
 `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
 [table, col]
 );
 return Number(r[0]?.c) > 0;
}

async function createLeadFromEstimate(pool, builder, est, refNumber) {
 const [b] = await pool.query('SELECT first_name, last_name, email, phone, company FROM builders WHERE id = ?', [
 builder.builderId,
 ]);
 const builderRow = b[0] || {};
 const builderName = [builderRow.first_name, builderRow.last_name].filter(Boolean).join(' ');
 const services = Array.isArray(est.services) ? est.services.join(', ') : '';
 const notes = [
 `[Builder Portal] Estimate ${refNumber}`,
 `Builder: ${builderName} (${builderRow.company || ''})`,
 `Project type: ${est.project_type || ''}`,
 `Address: ${est.address || ''}`,
 `Services: ${services}`,
 `Area: ${est.area_sqft || ''} sqft`,
 `Urgency: ${est.urgency}`,
 est.site_access ? 'Site access: yes' : 'Site access: no',
 est.notes || '',
 ]
 .filter(Boolean)
 .join('\n');

 const name = builderRow.company || builderName || 'Builder referral';
 const email = builderRow.email || `builder+${builder.builderId}@portal.local`;
 const phone = builderRow.phone || '0000000000';
 const zip = '80202';
 const message = `Builder estimate ${refNumber} - ${est.address || 'see notes'}`.slice(0, 65535);

 const hasReferring = await columnExists(pool, 'leads', 'referring_builder_id');
 const cols = ['name', 'email', 'phone', 'zipcode', 'message', 'source', 'form_type', 'status', 'notes'];
 const vals = [name.slice(0, 255), email, phone.slice(0, 50), zip, message, 'Portal Builder', 'builder_estimate', 'new_lead', notes.slice(0, 65535)];
 if (hasReferring) {
 cols.push('referring_builder_id');
 vals.push(builder.builderId);
 }

 const [ins] = await pool.execute(
 `INSERT INTO leads (${cols.map((c) => `\`${c}\``).join(', ')}, created_at) VALUES (${cols.map(() => '?').join(', ')}, NOW())`,
 vals
 );
 return ins.insertId;
}

export async function postEstimateRequest(req, res) {
 try {
 const pool = await getDBConnection();
 if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

 const builderId = req.builderAuth.builderId;
 const body = req.body || {};
 let services = [];
 try {
 if (body.services) {
 services = typeof body.services === 'string' ? JSON.parse(body.services) : body.services;
 }
 } catch {
 services = [];
 }
 if (!Array.isArray(services)) services = [];
 const refNumber = await generateEstimateRefNumber(pool);
 let attachmentUrl = body.attachment_url || null;
 const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
 if (files.length && !attachmentUrl) {
 const rel = path.join('estimates', String(builderId), files[0].filename).replace(/\\/g, '/');
 attachmentUrl = `/uploads/${rel}`;
 }

 const siteAccess =
 body.site_access === '1' || body.site_access === true || body.site_access === 'true' ? 1 : 0;
 const estRow = {
 project_type: body.project_type || null,
 address: body.address || null,
 services: JSON.stringify(Array.isArray(services) ? services : []),
 area_sqft: body.area_sqft != null ? parseInt(body.area_sqft, 10) : null,
 desired_start: body.desired_start || null,
 urgency: body.urgency || 'flexible',
 notes: body.notes || null,
 site_access: siteAccess,
 };

 const hasSiteAccess = await columnExists(pool, 'estimate_requests', 'site_access');
 const insertCols = [
 'builder_id',
 'ref_number',
 'project_type',
 'address',
 'services',
 'area_sqft',
 'desired_start',
 'urgency',
 'notes',
 'attachment_url',
 'status',
 ];
 const insertVals = [
 builderId,
 refNumber,
 estRow.project_type,
 estRow.address,
 estRow.services,
 estRow.area_sqft,
 estRow.desired_start,
 estRow.urgency,
 estRow.notes,
 attachmentUrl,
 'pending',
 ];
 if (hasSiteAccess) {
 insertCols.splice(insertCols.length - 1, 0, 'site_access');
 insertVals.splice(insertVals.length - 1, 0, siteAccess);
 }

 const [ins] = await pool.execute(
 `INSERT INTO estimate_requests (${insertCols.map((c) => `\`${c}\``).join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
 insertVals
 );

 const leadId = await createLeadFromEstimate(pool, req.builderAuth, { ...estRow, services }, refNumber);
 await pool.execute('UPDATE estimate_requests SET lead_id = ? WHERE id = ?', [leadId, ins.insertId]);

 if (await tableExists(pool, 'estimate_request_files')) {
 for (const f of files) {
 const rel = path.join('estimates', String(builderId), f.filename).replace(/\\/g, '/');
 await pool.execute(
 'INSERT INTO estimate_request_files (estimate_request_id, url, original_name) VALUES (?, ?, ?)',
 [ins.insertId, `/uploads/${rel}`, f.originalname || null]
 );
 }
 }
 if (await tableExists(pool, 'estimate_request_events')) {
 await pool.execute(
 'INSERT INTO estimate_request_events (estimate_request_id, status, note) VALUES (?, ?, ?)',
 [ins.insertId, 'pending', 'Request submitted']
 );
 logEstimateEvent(pool, builderId, refNumber, 'pending', 'Request submitted').catch(() => {});
 }

 const [builder] = await pool.query(
 'SELECT email, first_name, notification_prefs FROM builders WHERE id = ?',
 [builderId]
 );
 const pub = process.env.PUBLIC_CRM_URL || '';
 const svcList = Array.isArray(services) ? services.join(', ') : '';
 if (builder[0]?.email && builderWantsEmail(builder[0].notification_prefs, 'project_status')) {
 sendBuilderNotification({
 to: builder[0].email,
 subject: `Estimate request received - ${refNumber}`,
 html: `<p>Hi ${builder[0].first_name || 'there'},</p>
<p>We received your estimate request <strong>${refNumber}</strong>.</p>
<ul>
 <li><strong>Address:</strong> ${estRow.address || 'n/a'}</li>
 <li><strong>Services:</strong> ${svcList || 'n/a'}</li>
 <li><strong>Area:</strong> ${estRow.area_sqft || 'n/a'} sq ft</li>
</ul>
<p>Our team will contact you within <strong>48 hours</strong>.</p>
<p><a href="${pub}/builder-referrals.html">Track status in Referrals</a></p>`,
 }).catch(() => {});
 }
 const adminTo = adminNotifyEmail();
 if (adminTo) {
 sendBuilderNotification({
 to: adminTo,
 subject: `New builder estimate - ${refNumber}`,
 html: `<p>New estimate request from builder portal.</p><p>Ref: <strong>${refNumber}</strong></p><p>Address: ${estRow.address || 'n/a'}</p><p><a href="${pub}/dashboard.html?page=leads">View leads</a></p>`,
 }).catch(() => {});
 }

 notifyBuilder(pool, builderId, {
 type: 'estimate',
 title: `Estimate request ${refNumber}`,
 body: 'We received your request. Our team will respond within 48 hours.',
 linkUrl: '/builder-referrals.html',
 }).catch(() => {});

 res.status(201).json({
 success: true,
 data: { id: ins.insertId, ref_number: refNumber, lead_id: leadId },
 });
 } catch (e) {
 console.error('postEstimateRequest:', e);
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function postPricingCalculate(req, res) {
 try {
 const area = Math.max(0, parseInt(req.body?.area_sqft, 10) || 0);
 const serviceId = parseInt(req.body?.service_id, 10);
 if (!area || !Number.isFinite(serviceId)) {
 return res.status(400).json({ success: false, error: 'area_sqft and service_id required' });
 }

 const pool = await getDBConnection();
 const services = await getPartnerPricingForBuilder(pool, req.builderAuth.builderId);
 const svc = services.find((s) => s.id === serviceId);
 if (!svc || svc.is_locked) {
 return res.status(404).json({ success: false, error: 'Service not available' });
 }
 const line = calculateLine(svc, area);
 res.json({
 success: true,
 data: {
 service: line.service,
 unit: line.unit,
 rate: line.partner_rate,
 area_sqft: line.area_sqft,
 estimate_low: line.estimate_low,
 estimate_high: line.estimate_high,
 volume_discount_pct: line.volume_discount_pct,
 estimate_low_discounted: line.estimate_low_discounted,
 estimate_high_discounted: line.estimate_high_discounted,
 public_estimate_low: line.public_estimate_low,
 public_estimate_high: line.public_estimate_high,
 public_savings_low: line.public_savings_low,
 public_savings_high: line.public_savings_high,
 },
 });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function listEstimateRequestsAdmin(req, res) {
 try {
 const pool = await getDBConnection();
 const status = req.query.status || null;
 let where = '1=1';
 const params = [];
 if (status) {
 where += ' AND e.status = ?';
 params.push(status);
 }
 const [rows] = await pool.query(
 `SELECT e.*, b.first_name, b.last_name, b.company, b.email AS builder_email
 FROM estimate_requests e
 JOIN builders b ON b.id = e.builder_id
 WHERE ${where}
 ORDER BY e.created_at DESC
 LIMIT 100`,
 params
 );
 res.json({ success: true, data: rows });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function updateEstimateRequest(req, res) {
 try {
 const pool = await getDBConnection();
 const id = parseInt(req.params.id, 10);
 const { status, admin_notes } = req.body || {};
 const normalizedStatus = status ? normalizeEstimateStatus(status) : null;
 const [prev] = await pool.query('SELECT builder_id, status, ref_number FROM estimate_requests WHERE id = ?', [
 id,
 ]);
 await pool.execute(
 'UPDATE estimate_requests SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?',
 [normalizedStatus, admin_notes, id]
 );
 if (normalizedStatus && (await tableExists(pool, 'estimate_request_events'))) {
 await pool.execute(
 'INSERT INTO estimate_request_events (estimate_request_id, status, note) VALUES (?, ?, ?)',
 [id, normalizedStatus, admin_notes ? String(admin_notes).slice(0, 500) : 'Status updated']
 );
 if (prev[0]?.builder_id) {
 logEstimateEvent(
 pool,
 prev[0].builder_id,
 prev[0].ref_number,
 normalizedStatus,
 admin_notes ? String(admin_notes).slice(0, 500) : 'Status updated'
 ).catch(() => {});
 }
 }
 const [rows] = await pool.query('SELECT * FROM estimate_requests WHERE id = ?', [id]);
 const row = rows[0];
 if (normalizedStatus && prev[0] && prev[0].status !== normalizedStatus && prev[0].builder_id) {
 const [b] = await pool.query(
 'SELECT email, first_name, notification_prefs FROM builders WHERE id = ?',
 [prev[0].builder_id]
 );
 if (b[0]?.email && builderWantsEmail(b[0].notification_prefs, 'project_status')) {
 sendBuilderNotification({
 to: b[0].email,
 subject: `Estimate ${prev[0].ref_number} - ${estimateStatusLabel(normalizedStatus)}`,
 html: `<p>Hi ${b[0].first_name || 'there'},</p><p>Your estimate <strong>${prev[0].ref_number}</strong> is now: <strong>${estimateStatusLabel(normalizedStatus)}</strong>.</p><p><a href="${process.env.PUBLIC_CRM_URL || ''}/builder-referrals.html">View referrals</a></p>`,
 }).catch(() => {});
 }
 notifyBuilder(pool, prev[0].builder_id, {
 type: 'estimate',
 title: `Estimate ${prev[0].ref_number} updated`,
 body: `Status: ${estimateStatusLabel(normalizedStatus)}`,
 linkUrl: '/builder-referrals.html',
 }).catch(() => {});
 }
 res.json({ success: true, data: row });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function listBuilderHistory(req, res) {
 try {
 const pool = await getDBConnection();
 const builderId = req.builderAuth.builderId;
 const cid = await getBuilderCustomerId(pool, builderId);
 if (!cid) return res.json({ success: true, data: [] });
 const linkMeta = await getProjectBuilderLinkMeta(pool);
 const match = buildProjectBuilderMatch('p', builderId, cid, linkMeta);
 const selectSql = await buildProjectSelectSql(
 pool,
 [
 'id',
 'name',
 'address',
 'status',
 'contract_value',
 'completion_percentage',
 'flooring_type',
 'total_sqft',
 'project_number',
 'end_date_actual',
 'start_date',
 ],
 'p'
 );
 const orderSql = await buildProjectOrderSql(pool, 'end_date_actual', 'p');
 const [rows] = await pool.query(
 `SELECT ${selectSql}
 FROM projects p
 WHERE ${match.sql}${projectNotDeletedClause('p', linkMeta)}
 AND status IN ('completed','closed')
 ORDER BY ${orderSql} DESC`,
 match.params
 );

 const projectIds = rows.map((r) => r.id).filter(Boolean);
 const photoCounts = {};
 if (projectIds.length) {
 const [ph] = await pool.query(
 `SELECT project_id, COUNT(*) AS c FROM project_photos WHERE project_id IN (${projectIds.map(() => '?').join(',')}) GROUP BY project_id`,
 projectIds
 );
 ph.forEach((row) => {
 photoCounts[row.project_id] = Number(row.c) || 0;
 });
 }

 let totalSqft = 0;
 let totalValue = 0;
 const data = rows.map((r) => {
 const sqft = Number(r.total_sqft) || 0;
 const val = Number(r.contract_value) || 0;
 totalSqft += sqft;
 totalValue += val;
 return {
 ...r,
 photo_count: photoCounts[r.id] || 0,
 completed_year: r.end_date_actual ? String(r.end_date_actual).slice(0, 4) : null,
 };
 });

 res.json({
 success: true,
 data,
 summary: {
 project_count: data.length,
 total_sqft: totalSqft,
 total_value: Math.round(totalValue * 100) / 100,
 },
 });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function listBuilderReferrals(req, res) {
 try {
 const pool = await getDBConnection();
 const builderId = req.builderAuth.builderId;
 const referrals = [];

 const hasReferring = await columnExists(pool, 'leads', 'referring_builder_id');
 if (hasReferring) {
 const [leads] = await pool.query(
 `SELECT id, name, email, status, created_at, notes
 FROM leads WHERE referring_builder_id = ?
 ORDER BY created_at DESC LIMIT 50`,
 [builderId]
 );
 leads.forEach((l) => {
 referrals.push({
 type: 'lead',
 id: l.id,
 title: l.name,
 status: l.status,
 created_at: l.created_at,
 value: null,
 });
 });
 }

 const [ests] = await pool.query(
 `SELECT id, ref_number, status, address, area_sqft, created_at, lead_id
 FROM estimate_requests WHERE builder_id = ?
 ORDER BY created_at DESC LIMIT 50`,
 [builderId]
 );
 const estIds = ests.map((e) => e.id);
 const eventsByEst = {};
 if (estIds.length && (await tableExists(pool, 'estimate_request_events'))) {
 const [ev] = await pool.query(
 `SELECT * FROM estimate_request_events WHERE estimate_request_id IN (${estIds.map(() => '?').join(',')}) ORDER BY created_at ASC`,
 estIds
 );
 ev.forEach((row) => {
 if (!eventsByEst[row.estimate_request_id]) eventsByEst[row.estimate_request_id] = [];
 eventsByEst[row.estimate_request_id].push(row);
 });
 }

 ests.forEach((e) => {
 referrals.push({
 type: 'estimate',
 id: e.id,
 ref_number: e.ref_number,
 title: e.ref_number,
 status: e.status,
 created_at: e.created_at,
 address: e.address,
 area_sqft: e.area_sqft,
 lead_id: e.lead_id,
 events: eventsByEst[e.id] || [{ status: e.status, note: 'Submitted', created_at: e.created_at }],
 });
 });

 referrals.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
 const won = referrals.filter((r) => ['won', 'quoted'].includes(String(r.status || '').toLowerCase()));
 res.json({
 success: true,
 data: referrals,
 summary: {
 submitted: referrals.length,
 converted: won.length,
 commission_accrued: 0,
 note: 'Commission tracking will appear when your referral program is active.',
 },
 });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function listBuilderEstimatesSelf(req, res) {
 try {
 const pool = await getDBConnection();
 const [rows] = await pool.query(
 'SELECT id, ref_number, status, address, area_sqft, created_at, lead_id FROM estimate_requests WHERE builder_id = ? ORDER BY created_at DESC',
 [req.builderAuth.builderId]
 );
 res.json({ success: true, data: rows });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export function registerBuilderEstimateRoutes(app) {
 app.post(
 '/api/estimate-requests',
 requireBuilderAuth,
 (req, res, next) => {
 uploadEstimateFiles.array('attachments', 5)(req, res, (err) => {
 if (err) return res.status(400).json({ success: false, error: err.message });
 next();
 });
 },
 postEstimateRequest
 );
 app.get('/api/estimate-requests/mine', requireBuilderAuth, listBuilderEstimatesSelf);
 app.get('/api/estimate-requests', requireAuth, requirePermission('builders.view'), listEstimateRequestsAdmin);
 app.put('/api/estimate-requests/:id', requireAuth, requirePermission('builders.edit'), updateEstimateRequest);

 app.post('/api/pricing/calculate', requireBuilderAuth, postPricingCalculate);
 app.get('/api/builder-history', requireBuilderAuth, listBuilderHistory);
 app.get('/api/builder-referrals', requireBuilderAuth, listBuilderReferrals);
}
