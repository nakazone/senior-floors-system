/**
 * API Routes para Lead Qualification
 * GET, POST, PUT /api/leads/:leadId/qualification
 */

import { getDBConnection } from '../config/db.js';

export async function getQualification(req, res) {
  const leadId = parseInt(req.params.leadId);
  
  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  try {
    const pool = await getDBConnection();
    const [rows] = await pool.execute(
      `SELECT q.*, u.name as qualified_by_name 
       FROM lead_qualification q
       LEFT JOIN users u ON q.qualified_by = u.id
       WHERE q.lead_id = ?`,
      [leadId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Qualification not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error getting qualification:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function createOrUpdateQualification(req, res) {
  const leadId = parseInt(req.params.leadId);
  const userId = req.session?.user?.id;
  
  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  const body = req.body || {};
  const str = (v) => (v === undefined || v === null ? null : String(v));
  const trimStr = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };
  const num = (v) => (v === undefined || v === null || v === '' ? null : (parseFloat(v) || null));
  const int = (v) => (v === undefined || v === null || v === '' ? null : (parseInt(v, 10) || null));

  const property_type = str(body.property_type);
  const service_type = str(body.service_type);
  const estimated_area = num(body.estimated_area);
  const estimated_budget = num(body.estimated_budget);
  const urgency = str(body.urgency);
  const decision_maker = str(body.decision_maker);
  const decision_timeline = str(body.decision_timeline);
  const payment_type = str(body.payment_type);
  const score = int(body.score);
  const qualification_notes = str(body.qualification_notes);
  const address_street = trimStr(body.address_street);
  const address_line2 = trimStr(body.address_line2);
  const address_city = trimStr(body.address_city);
  const address_state = trimStr(body.address_state);
  const address_zip = trimStr(body.address_zip);
  const qualified_by = userId === undefined || userId === null ? null : userId;

  try {
    const pool = await getDBConnection();
    
    // Verificar se já existe
    const [existing] = await pool.execute(
      'SELECT id FROM lead_qualification WHERE lead_id = ?',
      [leadId]
    );

    if (existing.length > 0) {
      // Update
      await pool.execute(
        `UPDATE lead_qualification SET
          property_type = ?, service_type = ?, estimated_area = ?,
          estimated_budget = ?, urgency = ?, decision_maker = ?,
          decision_timeline = ?, payment_type = ?, score = ?,
          qualification_notes = ?, address_street = ?, address_line2 = ?,
          address_city = ?, address_state = ?, address_zip = ?,
          qualified_by = ?, qualified_at = NOW()
        WHERE lead_id = ?`,
        [
          property_type, service_type, estimated_area,
          estimated_budget, urgency, decision_maker,
          decision_timeline, payment_type, score,
          qualification_notes, address_street, address_line2,
          address_city, address_state, address_zip,
          qualified_by, leadId
        ]
      );
    } else {
      // Insert
      await pool.execute(
        `INSERT INTO lead_qualification 
        (lead_id, property_type, service_type, estimated_area, estimated_budget,
         urgency, decision_maker, decision_timeline, payment_type, score,
         qualification_notes, address_street, address_line2, address_city,
         address_state, address_zip, qualified_by, qualified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          leadId, property_type, service_type, estimated_area,
          estimated_budget, urgency, decision_maker, decision_timeline,
          payment_type, score, qualification_notes, address_street, address_line2,
          address_city, address_state, address_zip, qualified_by
        ]
      );
    }

    // Buscar atualizado
    const [updated] = await pool.execute(
      `SELECT q.*, u.name as qualified_by_name 
       FROM lead_qualification q
       LEFT JOIN users u ON q.qualified_by = u.id
       WHERE q.lead_id = ?`,
      [leadId]
    );

    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error saving qualification:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
