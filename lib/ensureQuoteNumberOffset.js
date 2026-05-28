import { bumpLegacyQuoteNumbers } from './quoteNumber.js';

/** No arranque: Q-2026-0018 ? Q-2026-0118 (idempotente). */
export async function ensureQuoteNumberOffset(pool) {
  if (!pool) return;
  try {
    await bumpLegacyQuoteNumbers(pool);
  } catch (e) {
    console.warn('[db] Não foi possível migrar números de orçamento:', e.code || e.message);
  }
}
