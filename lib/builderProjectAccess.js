/** Verifica se o builder logado tem acesso ao projeto (via customers.builder_id). */
export async function getBuilderCustomerId(pool, builderId) {
  const [rows] = await pool.query('SELECT customer_id FROM builders WHERE id = ? LIMIT 1', [
    builderId,
  ]);
  const cid = rows[0]?.customer_id;
  return cid != null ? Number(cid) : null;
}

export async function assertBuilderOwnsProject(pool, builderId, projectId) {
  const customerId = await getBuilderCustomerId(pool, builderId);
  if (!customerId) return null;
  const [rows] = await pool.query(
    `SELECT p.* FROM projects p
     WHERE p.id = ? AND p.builder_id = ?
       AND (p.deleted_at IS NULL OR p.deleted_at = '0000-00-00 00:00:00')`,
    [projectId, customerId]
  );
  return rows[0] || null;
}

export function photoPublicUrl(row) {
  const fu = row.file_url != null ? String(row.file_url).trim() : '';
  if (fu) return fu.startsWith('/') ? fu : `/${fu}`;
  const fp = String(row.file_path || '').replace(/^\//, '');
  return fp ? `/uploads/${fp}` : '';
}
