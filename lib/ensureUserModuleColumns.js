/**
 * Garante colunas do módulo de utilizadores (must_change_password).
 */
export async function ensureUserModuleColumns(pool) {
  if (!pool) return;
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_change_password'`
    );
    if (cols.length > 0) return;
    await pool.query(
      'ALTER TABLE `users` ADD COLUMN `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 COMMENT \'1 = obrigar troca de senha no próximo login\''
    );
    console.log('[db] Adicionada coluna users.must_change_password');
  } catch (e) {
    console.warn('[db] Não foi possível garantir users.must_change_password:', e.code || e.message);
  }
}
