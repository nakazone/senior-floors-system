import { setLeadPipelineBySlug } from '../../lib/pipelineAutomation.js';
import { ensureClientFromLead } from '../clients/leadToClient.js';
import { nextProjectNumber, seedChecklistIfEmpty, moneyRound, money } from './projectHelpers.js';

/**
 * Quando um estimate é aceite: cria projeto se necessário ou sincroniza o existente.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} estimateId
 * @param {number|null} userId
 */
export async function createOrSyncProjectFromAcceptedEstimate(pool, estimateId, userId) {
  const eid = parseInt(String(estimateId), 10);
  if (!Number.isFinite(eid) || eid <= 0) {
    return { ok: false, error: 'invalid_estimate_id' };
  }

  const [estRows] = await pool.query(
    `SELECT e.*, l.name AS lead_name, l.address AS lead_address, l.zipcode AS lead_zipcode
     FROM estimates e
     LEFT JOIN leads l ON e.lead_id = l.id
     WHERE e.id = ?`,
    [eid]
  );
  if (!estRows.length) {
    return { ok: false, error: 'estimate_not_found' };
  }
  const est = estRows[0];

  let projectId = est.project_id != null ? parseInt(String(est.project_id), 10) : null;

  if (!projectId) {
    const leadId = est.lead_id != null ? parseInt(String(est.lead_id), 10) : null;
    if (!leadId) {
      return { ok: false, error: 'estimate_without_lead' };
    }
    const [leads] = await pool.query(
      `SELECT l.*, ps.slug AS pipeline_stage_slug
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [leadId]
    );
    if (!leads.length) {
      return { ok: false, error: 'lead_not_found' };
    }
    const conv = await ensureClientFromLead(pool, leads[0], { force: true });
    if (!conv.customer_id) {
      return { ok: false, error: conv.reason || 'lead_without_customer' };
    }
    const customerId = conv.customer_id;

    let flooringType = null;
    let totalSqft = null;
    const [meas] = await pool.query(
      `SELECT * FROM measurements WHERE lead_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [leadId]
    );
    if (meas.length) {
      const m = meas[0];
      totalSqft =
        m.area_sqft != null
          ? money(m.area_sqft)
          : m.final_area != null
            ? money(m.final_area)
            : m.total_sqft != null
              ? money(m.total_sqft)
              : null;
      flooringType = m.flooring_type != null ? String(m.flooring_type) : null;
    }
    if (totalSqft == null && est.adjusted_sqft != null) {
      totalSqft = money(est.adjusted_sqft);
    }
    if (flooringType == null && est.flooring_type != null) {
      flooringType = String(est.flooring_type);
    }

    const leadName = String(est.lead_name || 'Cliente').trim() || 'Cliente';
    const addr =
      String(est.lead_address || '').trim() ||
      [est.lead_zipcode].filter(Boolean).join(' ') ||
      'Endereço a definir';
    const floorLabel = (flooringType || 'Piso').toString();
    const name = `${leadName} - ${floorLabel} - ${addr}`.slice(0, 255);
    const finalPrice = money(est.final_price);
    const pn = await nextProjectNumber(pool);

    const [ins] = await pool.execute(
      `INSERT INTO projects (
        customer_id, lead_id, estimate_id, name, project_number, address,
        flooring_type, total_sqft, contract_value, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
      [
        customerId,
        leadId,
        eid,
        name,
        pn,
        String(est.lead_address || '').trim() || null,
        flooringType,
        totalSqft,
        finalPrice,
        userId || null,
      ]
    );
    projectId = ins.insertId;
    await pool.execute('UPDATE estimates SET project_id = ? WHERE id = ?', [projectId, eid]);
  }

  const [pRows] = await pool.query('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!pRows.length) {
    return { ok: false, error: 'project_not_found' };
  }

  let flooringType = null;
  let totalSqft = null;
  const leadId = est.lead_id != null ? parseInt(String(est.lead_id), 10) : null;

  if (leadId) {
    const [meas] = await pool.query(
      `SELECT * FROM measurements WHERE lead_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [leadId]
    );
    if (meas.length) {
      const m = meas[0];
      totalSqft =
        m.area_sqft != null
          ? money(m.area_sqft)
          : m.final_area != null
            ? money(m.final_area)
            : null;
      flooringType = m.flooring_type != null ? String(m.flooring_type) : null;
    }
  }

  if (totalSqft == null && est.adjusted_sqft != null) {
    totalSqft = money(est.adjusted_sqft);
  }
  if (flooringType == null && est.flooring_type != null) {
    flooringType = String(est.flooring_type);
  }

  const leadName = String(est.lead_name || 'Cliente').trim() || 'Cliente';
  const addr =
    String(est.lead_address || '').trim() ||
    [est.lead_zipcode].filter(Boolean).join(' ') ||
    'Endereço a definir';
  const floorLabel = (flooringType || 'Piso').toString();

  const name = `${leadName} - ${floorLabel} - ${addr}`.slice(0, 255);
  const finalPrice = money(est.final_price);
  const pn = await nextProjectNumber(pool);

  await pool.execute(
    `UPDATE projects SET
      estimate_id = ?,
      contract_value = ?,
      total_sqft = COALESCE(?, total_sqft),
      flooring_type = COALESCE(?, flooring_type),
      name = ?,
      project_number = IF(project_number IS NULL OR TRIM(project_number) = '', ?, project_number)
     WHERE id = ?`,
    [eid, finalPrice, totalSqft, flooringType, name, pn, projectId]
  );

  if (userId) {
    await pool.execute('UPDATE projects SET created_by = COALESCE(created_by, ?) WHERE id = ?', [
      userId,
      projectId,
    ]);
  }

  await seedChecklistIfEmpty(pool, projectId);

  if (leadId) {
    await setLeadPipelineBySlug(leadId, 'production');
  }

  const [out] = await pool.query('SELECT * FROM projects WHERE id = ?', [projectId]);
  return { ok: true, data: out[0] };
}
