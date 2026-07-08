/**
 * Company owner signature for quote PDFs + client signature helpers.
 */
const OWNER_SIG_KEY = 'quote_owner_signature';
const OWNER_NAME_KEY = 'quote_owner_sign_name';

function parsePngBase64(input) {
  if (!input) return null;
  let raw = String(input).trim();
  const m = raw.match(/^data:image\/png;base64,(.+)$/i);
  if (m) raw = m[1];
  try {
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length || buf.length > 2 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  }
}

export function parseSignaturePngBase64(input) {
  return parsePngBase64(input);
}

export async function getOwnerSignature(pool) {
  const [sigRows] = await pool.query(
    'SELECT blob_value FROM company_settings WHERE setting_key = ? LIMIT 1',
    [OWNER_SIG_KEY]
  );
  const [nameRows] = await pool.query(
    'SELECT text_value FROM company_settings WHERE setting_key = ? LIMIT 1',
    [OWNER_NAME_KEY]
  );
  const raw = sigRows[0]?.blob_value;
  let png = null;
  if (raw) {
    png = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (!png.length) png = null;
  }
  return {
    png,
    name: nameRows[0]?.text_value || null,
  };
}

export async function setOwnerSignature(pool, { name, signaturePngBase64, signatureBuffer }) {
  let buf = signatureBuffer || parsePngBase64(signaturePngBase64);
  if (!buf || !buf.length) {
    return { ok: false, error: 'Assinatura invùlida. Desenhe ou carregue uma imagem PNG.' };
  }
  const signName = name != null && String(name).trim() ? String(name).trim().slice(0, 255) : null;

  await pool.execute(
    `INSERT INTO company_settings (setting_key, blob_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE blob_value = VALUES(blob_value), updated_at = NOW()`,
    [OWNER_SIG_KEY, buf]
  );
  if (signName) {
    await pool.execute(
      `INSERT INTO company_settings (setting_key, text_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE text_value = VALUES(text_value), updated_at = NOW()`,
      [OWNER_NAME_KEY, signName]
    );
  }
  return { ok: true, name: signName, has_signature: true };
}

export async function getClientSignatureBuffer(quoteRow) {
  if (!quoteRow?.client_signature_png) return null;
  const b = quoteRow.client_signature_png;
  if (Buffer.isBuffer(b) && b.length) return b;
  if (b && typeof b === 'object' && b.length) return Buffer.from(b);
  return null;
}
