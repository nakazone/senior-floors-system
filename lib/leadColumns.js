/**
 * Cache of `leads` table columns (for optional marketing / UTM fields after migration).
 */
let cache = null;
let cacheTime = 0;
const TTL_MS = 60_000;

export async function getLeadsTableColumns(pool) {
  if (cache && Date.now() - cacheTime < TTL_MS) return cache;
  const [rows] = await pool.query('SHOW COLUMNS FROM leads');
  cache = new Set(rows.map((r) => r.Field));
  cacheTime = Date.now();
  return cache;
}

export function invalidateLeadsColumnCache() {
  cache = null;
}
