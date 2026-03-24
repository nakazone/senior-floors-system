import { getDBConnection } from '../config/db.js';

/** Move lead to pipeline stage by slug (best-effort). */
export async function setLeadPipelineBySlug(leadId, slug) {
  if (!leadId || !slug) return;
  const pool = await getDBConnection();
  if (!pool) return;
  try {
    const [stages] = await pool.execute(
      'SELECT id FROM pipeline_stages WHERE slug = ? ORDER BY order_num LIMIT 1',
      [slug]
    );
    if (!stages.length) return;
    await pool.execute(
      'UPDATE leads SET pipeline_stage_id = ?, status = ?, updated_at = NOW() WHERE id = ?',
      [stages[0].id, slug, leadId]
    );
  } catch (e) {
    console.warn('[pipelineAutomation]', e.message);
  }
}
