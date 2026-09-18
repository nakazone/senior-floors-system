import { getDBConnection } from '../config/db.js';
import { ensureProjectFromWonLead } from '../modules/projects/fromWonLead.js';

/**
 * Move lead to pipeline stage by slug (best-effort).
 * @param {number|string} leadId
 * @param {string} slug
 * @param {{ force?: boolean }} [opts] — force=true move mesmo de estágios fechados
 */
export async function setLeadPipelineBySlug(leadId, slug, opts = {}) {
  if (!leadId || !slug) return;
  const pool = await getDBConnection();
  if (!pool) return;
  try {
    const [stages] = await pool.execute(
      'SELECT id, is_closed FROM pipeline_stages WHERE slug = ? ORDER BY order_num LIMIT 1',
      [slug]
    );
    if (!stages.length) return;
    const target = stages[0];

    if (!opts.force) {
      const [cur] = await pool.query(
        `SELECT ps.is_closed AS closed
         FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
         WHERE l.id = ? LIMIT 1`,
        [leadId]
      );
      // Não puxar para trás leads já em Won / Lost / outros estágios finais
      if (cur.length && Number(cur[0].closed) === 1 && Number(target.is_closed) !== 1) {
        return;
      }
    }

    const [cols] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'pipeline_stage_entered_at'`
    );
    const hasEntered = Number(cols[0]?.c) > 0;
    if (hasEntered) {
      await pool.execute(
        `UPDATE leads
         SET pipeline_stage_id = ?, status = ?, pipeline_stage_entered_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [target.id, slug, leadId]
      );
    } else {
      await pool.execute(
        'UPDATE leads SET pipeline_stage_id = ?, status = ?, updated_at = NOW() WHERE id = ?',
        [target.id, slug, leadId]
      );
    }

    if (slug === 'closed_won') {
      try {
        await ensureProjectFromWonLead(pool, leadId, null);
      } catch (e) {
        console.warn('[pipelineAutomation] ensureProjectFromWonLead:', e.message);
      }
    }
  } catch (e) {
    console.warn('[pipelineAutomation]', e.message);
  }
}

/**
 * Após envio de orçamento, move o lead ligado para Quote Sent.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number|string} quoteId
 */
export async function moveLeadToQuoteSentForQuote(pool, quoteId) {
  const id = parseInt(String(quoteId), 10);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: 'invalid_id' };
  try {
    const [rows] = await pool.query('SELECT lead_id FROM quotes WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return { ok: false, reason: 'quote_not_found' };
    const leadId = rows[0].lead_id != null ? parseInt(String(rows[0].lead_id), 10) : null;
    if (!leadId || leadId <= 0) return { ok: false, reason: 'no_lead' };
    await setLeadPipelineBySlug(leadId, 'quote_sent');
    return { ok: true, lead_id: leadId };
  } catch (e) {
    console.warn('[pipelineAutomation] moveLeadToQuoteSentForQuote:', e.message);
    return { ok: false, reason: e.message };
  }
}
