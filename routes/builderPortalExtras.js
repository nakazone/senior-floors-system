/**
 * Builder portal — photos delete, materials approval, confirm access, activity.
 */
import path from 'path';
import fs from 'fs';
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import {
  assertBuilderOwnsProject,
  buildProjectBuilderMatch,
  getBuilderCustomerId,
  getProjectBuilderLinkMeta,
  projectNotDeletedClause,
} from '../lib/builderProjectAccess.js';
import { refreshChecklistCompletedFlag } from '../modules/projects/projectHelpers.js';
import { notifyBuilder } from './builderNotifications.js';
import { adminNotifyEmail, sendBuilderNotification } from '../lib/builderNotify.js';

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

export async function deleteBuilderProjectPhoto(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const photoId = parseInt(req.params.photoId, 10);
    const bid = req.builderAuth.builderId;
    const project = await assertBuilderOwnsProject(pool, bid, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const hasPartner = await columnExists(pool, 'project_photos', 'partner_upload');
    const hasBuilderCol = await columnExists(pool, 'project_photos', 'uploaded_by_builder_id');
    let sql = 'SELECT * FROM project_photos WHERE id = ? AND project_id = ?';
    const [rows] = await pool.query(sql, [photoId, projectId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Photo not found' });
    const ph = rows[0];
    if (hasPartner && ph.partner_upload !== 1) {
      return res.status(403).json({ success: false, error: 'Only photos you uploaded can be removed' });
    }
    if (hasBuilderCol && ph.uploaded_by_builder_id && Number(ph.uploaded_by_builder_id) !== bid) {
      return res.status(403).json({ success: false, error: 'Only your uploads can be removed' });
    }

    const fp = String(ph.file_path || '').replace(/^\//, '');
    if (fp) {
      const abs = path.join(process.cwd(), 'uploads', fp);
      try {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (_) {
        /* ignore */
      }
    }
    await pool.execute('DELETE FROM project_photos WHERE id = ? AND project_id = ?', [photoId, projectId]);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteBuilderProjectPhoto:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putBuilderProjectMaterial(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const mid = parseInt(req.params.materialId, 10);
    const bid = req.builderAuth.builderId;
    const project = await assertBuilderOwnsProject(pool, bid, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const status = String(req.body?.builder_approval_status || '').toLowerCase();
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid approval status' });
    }
    const hasVisible = await columnExists(pool, 'project_materials', 'visible_to_builder');
    const hasApproval = await columnExists(pool, 'project_materials', 'builder_approval_status');
    if (!hasApproval) {
      return res.status(503).json({ success: false, error: 'Materials approval not available yet' });
    }

    const where = hasVisible
      ? 'id = ? AND project_id = ? AND visible_to_builder = 1'
      : 'id = ? AND project_id = ?';
    const comment =
      req.body?.builder_comment != null ? String(req.body.builder_comment).slice(0, 2000) : null;

    await pool.execute(
      `UPDATE project_materials SET builder_approval_status = ?, builder_comment = ? WHERE ${where}`,
      [status, comment, mid, projectId]
    );

    if (status === 'rejected' || status === 'approved') {
      const adminTo = adminNotifyEmail();
      if (adminTo) {
        const [m] = await pool.query(
          'SELECT product_name FROM project_materials WHERE id = ?',
          [mid]
        );
        await sendBuilderNotification({
          to: adminTo,
          subject: `Builder ${status} material on project #${projectId}`,
          html: `<p>Material <strong>${m[0]?.product_name || mid}</strong> was <strong>${status}</strong> by the partner.</p>${comment ? `<p>Comment: ${comment}</p>` : ''}`,
        });
      }
    }

    const [rows] = await pool.query('SELECT * FROM project_materials WHERE id = ?', [mid]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('putBuilderProjectMaterial:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderMaterialsApproveAll(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.id, 10);
    const bid = req.builderAuth.builderId;
    const project = await assertBuilderOwnsProject(pool, bid, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const hasVisible = await columnExists(pool, 'project_materials', 'visible_to_builder');
    const where = hasVisible
      ? 'project_id = ? AND visible_to_builder = 1 AND builder_approval_status = \'pending\''
      : 'project_id = ? AND builder_approval_status = \'pending\'';
    const [r] = await pool.execute(
      `UPDATE project_materials SET builder_approval_status = 'approved' WHERE ${where}`,
      [projectId]
    );
    res.json({ success: true, updated: r.affectedRows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderConfirmAccess(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.id, 10);
    const bid = req.builderAuth.builderId;
    const project = await assertBuilderOwnsProject(pool, bid, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const [existing] = await pool.query(
      `SELECT id FROM project_checklist WHERE project_id = ? AND item = ? LIMIT 1`,
      [projectId, 'Property access confirmed by builder']
    );
    const hasVisible = await columnExists(pool, 'project_checklist', 'visible_to_builder');
    const hasAssigned = await columnExists(pool, 'project_checklist', 'assigned_to');

    if (existing.length) {
      await pool.execute(
        'UPDATE project_checklist SET checked = 1, checked_at = NOW() WHERE id = ?',
        [existing[0].id]
      );
    } else {
      const cols = ['project_id', 'category', 'item', 'checked', 'checked_at'];
      const vals = [projectId, 'Access', 'Property access confirmed by builder', 1, new Date()];
      if (hasVisible) {
        cols.push('visible_to_builder');
        vals.push(1);
      }
      if (hasAssigned) {
        cols.push('assigned_to');
        vals.push('builder');
      }
      await pool.execute(
        `INSERT INTO project_checklist (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        vals
      );
    }
    await refreshChecklistCompletedFlag(pool, projectId);

    const adminTo = adminNotifyEmail();
    if (adminTo) {
      await sendBuilderNotification({
        to: adminTo,
        subject: `Builder confirmed property access — ${project.name || projectId}`,
        html: `<p>Partner confirmed site access for project <strong>${project.name || projectId}</strong>.</p><p>${project.address || ''}</p>`,
      });
    }

    res.json({ success: true, message: 'Property access confirmed' });
  } catch (e) {
    console.error('postBuilderConfirmAccess:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function buildBuilderActivityFeed(pool, builderId, limit = 12) {
  const items = [];

  const [messages] = await pool.query(
    `SELECT m.message, m.created_at, m.project_id, m.sender_type, p.name AS project_name
     FROM builder_messages m
     LEFT JOIN projects p ON m.project_id = p.id
     WHERE m.builder_id = ? AND m.is_internal_note = 0
     ORDER BY m.created_at DESC LIMIT 6`,
    [builderId]
  );
  messages.forEach((m) => {
    items.push({
      type: m.sender_type === 'admin' ? 'message_sf' : 'message_builder',
      text:
        m.sender_type === 'admin'
          ? `Senior Floors: ${String(m.message || '').slice(0, 100)}`
          : `You: ${String(m.message || '').slice(0, 100)}`,
      project_id: m.project_id,
      project_name: m.project_name,
      created_at: m.created_at,
    });
  });

  if (await columnExists(pool, 'project_photos', 'partner_upload')) {
    const cid = await getBuilderCustomerId(pool, builderId);
    const meta = await getProjectBuilderLinkMeta(pool);
    const match = buildProjectBuilderMatch('p', builderId, cid, meta);
    try {
      const [photos] = await pool.query(
        `SELECT ph.created_at, ph.project_id, p.name AS project_name, ph.phase
         FROM project_photos ph
         INNER JOIN projects p ON p.id = ph.project_id
         WHERE ${match.sql}${projectNotDeletedClause('p', meta)}
         ORDER BY ph.created_at DESC LIMIT 4`,
        match.params
      );
      photos.forEach((ph) => {
        items.push({
          type: 'photo',
          text: `Photo added (${ph.phase || 'site'})`,
          project_id: ph.project_id,
          project_name: ph.project_name,
          created_at: ph.created_at,
        });
      });
    } catch (_) {
      /* ignore */
    }
  }

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return items.slice(0, limit);
}

export function registerBuilderPortalExtraRoutes(app) {
  app.delete(
    '/api/builder-projects/:id/photos/:photoId',
    requireBuilderAuth,
    deleteBuilderProjectPhoto
  );
  app.put(
    '/api/builder-projects/:id/materials/:materialId',
    requireBuilderAuth,
    putBuilderProjectMaterial
  );
  app.post(
    '/api/builder-projects/:id/materials/approve-all',
    requireBuilderAuth,
    postBuilderMaterialsApproveAll
  );
  app.post('/api/builder-projects/:id/confirm-access', requireBuilderAuth, postBuilderConfirmAccess);
}
