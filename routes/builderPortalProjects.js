/**
 * Builder portal — project tracking, photos, checklist (scoped to logged-in partner).
 */
import path from 'path';
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { uploadProjectPhoto } from '../lib/projectPhotoUpload.js';
import {
  assertBuilderOwnsProject,
  buildProjectBuilderMatch,
  buildProjectOrderSql,
  buildProjectSelectSql,
  getBuilderCustomerId,
  getProjectBuilderLinkMeta,
  normalizeProjectRow,
  photoPublicUrl,
  projectNotDeletedClause,
} from '../lib/builderProjectAccess.js';
import { refreshChecklistCompletedFlag } from '../modules/projects/projectHelpers.js';

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

const TIMELINE_STEPS = [
  { key: 'scheduled', label: 'Scheduled', minPct: 0 },
  { key: 'material', label: 'Material confirmed', minPct: 10 },
  { key: 'start', label: 'Work started', minPct: 25 },
  { key: 'installation', label: 'Installation', minPct: 45 },
  { key: 'finishing', label: 'Finishing', minPct: 70 },
  { key: 'inspection', label: 'Final inspection', minPct: 90 },
  { key: 'completed', label: 'Completed', minPct: 100 },
];

function buildTimeline(project) {
  const pct = Number(project.completion_percentage) || 0;
  const st = String(project.status || '').toLowerCase();
  const forceDone = st === 'completed' || pct >= 100;
  return TIMELINE_STEPS.map((step, idx) => {
    const next = TIMELINE_STEPS[idx + 1];
    const done = forceDone || pct >= (next ? next.minPct : 100);
    const active = !done && pct >= step.minPct && (!next || pct < next.minPct);
    return {
      ...step,
      status: done ? 'done' : active ? 'active' : 'pending',
    };
  });
}

export async function getBuilderPortalProject(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const project = normalizeProjectRow(
      await assertBuilderOwnsProject(pool, req.builderAuth.builderId, projectId)
    );
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const [checklist] = await pool.query(
      `SELECT id, category, item, checked, notes, assigned_to, visible_to_builder
       FROM project_checklist WHERE project_id = ? AND visible_to_builder = 1
       ORDER BY sort_order ASC, id ASC`,
      [projectId]
    );

    const [photos] = await pool.query(
      `SELECT id, phase, file_path, file_url, caption, created_at, partner_upload, uploaded_by_builder_id
       FROM project_photos WHERE project_id = ? ORDER BY created_at DESC`,
      [projectId]
    );

    let manager = null;
    if (project.assigned_to) {
      const [u] = await pool.query('SELECT id, name, email FROM users WHERE id = ? LIMIT 1', [
        project.assigned_to,
      ]);
      if (u.length) manager = u[0];
    }

    const safeProject = {
      id: project.id,
      name: project.name,
      address: project.address,
      status: project.status,
      completion_percentage: project.completion_percentage,
      start_date: project.start_date,
      end_date_estimated: project.end_date_estimated,
      end_date_actual: project.end_date_actual,
      flooring_type: project.flooring_type,
      total_sqft: project.total_sqft,
      service_type: project.service_type,
      project_number: project.project_number,
      client_notes: project.notes,
    };

    res.json({
      success: true,
      data: {
        project: safeProject,
        timeline: buildTimeline(project),
        checklist,
        photos: photos.map((ph) => ({
          ...ph,
          url: photoPublicUrl(ph),
          partner_label: ph.partner_upload ? 'Sent by partner' : null,
        })),
        manager,
      },
    });
  } catch (e) {
    console.error('getBuilderPortalProject:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderProjectPhotos(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const project = await assertBuilderOwnsProject(pool, req.builderAuth.builderId, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    if (!req.file) return res.status(400).json({ success: false, error: 'file required' });

    const phase = ['before', 'during', 'after'].includes(req.body?.phase) ? req.body.phase : 'during';
    const rel = path.join('projects', String(projectId), req.file.filename).replace(/\\/g, '/');
    const fileUrl = `/uploads/${rel}`;
    const builderId = req.builderAuth.builderId;
    const hasFileUrl = await columnExists(pool, 'project_photos', 'file_url');
    const hasPartner = await columnExists(pool, 'project_photos', 'partner_upload');
    const hasBuilderCol = await columnExists(pool, 'project_photos', 'uploaded_by_builder_id');

    const caption =
      req.body?.caption != null
        ? String(req.body.caption).slice(0, 255)
        : 'Sent by partner';

    const cols = ['project_id', 'phase', 'filename', 'original_name', 'file_path'];
    const vals = [projectId, phase, req.file.filename, req.file.originalname || null, rel];
    if (hasFileUrl) {
      cols.push('file_url');
      vals.push(fileUrl);
    }
    cols.push('file_size', 'mime_type', 'caption');
    vals.push(req.file.size || null, req.file.mimetype || null, caption);
    if (hasPartner) {
      cols.push('partner_upload');
      vals.push(1);
    }
    if (hasBuilderCol) {
      cols.push('uploaded_by_builder_id');
      vals.push(builderId);
    }

    const [ins] = await pool.execute(
      `INSERT INTO project_photos (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      vals
    );
    const [rows] = await pool.query('SELECT * FROM project_photos WHERE id = ?', [ins.insertId]);
    const row = rows[0];
    res.status(201).json({
      success: true,
      data: { ...row, url: photoPublicUrl(row), partner_label: 'Sent by partner' },
    });
  } catch (e) {
    console.error('postBuilderProjectPhotos:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putBuilderProjectChecklist(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const project = await assertBuilderOwnsProject(pool, req.builderAuth.builderId, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const [items] = await pool.query(
      `SELECT * FROM project_checklist WHERE id = ? AND project_id = ? AND visible_to_builder = 1`,
      [itemId, projectId]
    );
    if (!items.length) return res.status(404).json({ success: false, error: 'Checklist item not found' });
    const item = items[0];
    if (String(item.assigned_to || 'sf').toLowerCase() !== 'builder') {
      return res.status(403).json({
        success: false,
        error: 'This item can only be completed by Senior Floors',
      });
    }

    const checked = !!req.body?.checked;
    await pool.execute(
      `UPDATE project_checklist SET checked = ?, checked_at = IF(? = 1, NOW(), NULL), checked_by = NULL
       WHERE id = ? AND project_id = ?`,
      [checked ? 1 : 0, checked ? 1 : 0, itemId, projectId]
    );
    await refreshChecklistCompletedFlag(pool, projectId);
    const [rows] = await pool.query('SELECT * FROM project_checklist WHERE id = ?', [itemId]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('putBuilderProjectChecklist:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listBuilderPortalProjects(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const auth = req.builderAuth;
    const cid = await getBuilderCustomerId(pool, auth.builderId);
    if (!cid) {
      return res.json({
        success: true,
        data: [],
        hint: 'Builder account is not linked to a CRM customer. Contact Senior Floors.',
      });
    }
    const linkMeta = await getProjectBuilderLinkMeta(pool);
    const match = buildProjectBuilderMatch('p', auth.builderId, cid, linkMeta);
    const selectSql = await buildProjectSelectSql(
      pool,
      [
        'id',
        'name',
        'address',
        'status',
        'completion_percentage',
        'start_date',
        'end_date_estimated',
        'end_date_actual',
        'flooring_type',
        'total_sqft',
        'project_number',
      ],
      'p'
    );
    const orderSql = await buildProjectOrderSql(pool, 'updated_at', 'p');
    const [rows] = await pool.query(
      `SELECT ${selectSql}
       FROM projects p
       WHERE ${match.sql}${projectNotDeletedClause('p', linkMeta)}
       ORDER BY ${orderSql} DESC`,
      match.params
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listBuilderPortalProjects:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderPortalProjectRoutes(app) {
  app.get('/api/builder-projects', requireBuilderAuth, listBuilderPortalProjects);
  app.get('/api/builder-projects/:id', requireBuilderAuth, getBuilderPortalProject);
  app.post(
    '/api/builder-projects/:id/photos',
    requireBuilderAuth,
    (req, res, next) => {
      uploadProjectPhoto.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message });
        next();
      });
    },
    postBuilderProjectPhotos
  );
  app.put(
    '/api/builder-projects/:id/checklist/:itemId',
    requireBuilderAuth,
    putBuilderProjectChecklist
  );
}
