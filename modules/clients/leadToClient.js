/**
 * Converte lead em registo na tabela `customers` (Clients).
 * Automático nos estágios `closed_won` e `production` (fluxo CRM concluído / obra).
 */

/** @param {import('mysql2/promise').Pool} pool */
export async function customerTableColumns(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'`
  );
  return new Set(rows.map((r) => r.n));
}

/** Estágios em que criamos cliente automaticamente (se ainda não existir). */
export const AUTO_CONVERT_STAGE_SLUGS = new Set(['closed_won', 'production']);

const PLACEHOLDER_PHONE = '—';

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {Record<string, unknown>} leadRow — linha de lead com `pipeline_stage_slug` ou `status`
 * @param {{ force?: boolean, customer_type?: string }} [opts]
 * @returns {Promise<{ created: boolean, customer_id?: number, reason?: string }>}
 */
export async function ensureClientFromLead(pool, leadRow, opts = {}) {
  const force = !!opts.force;
  const slug = String(leadRow.pipeline_stage_slug || leadRow.status || '').trim();
  if (!force && !AUTO_CONVERT_STAGE_SLUGS.has(slug)) {
    return { created: false, reason: 'stage_not_converting' };
  }

  const leadId = Number(leadRow.id);
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return { created: false, reason: 'invalid_lead' };
  }

  const cols = await customerTableColumns(pool);
  const hasLeadIdCol = cols.has('lead_id');

  if (hasLeadIdCol) {
    const [existing] = await pool.query('SELECT id FROM customers WHERE lead_id = ? LIMIT 1', [leadId]);
    if (existing.length) {
      return { created: false, customer_id: existing[0].id, reason: 'already_linked' };
    }
  }

  const name = String(leadRow.name || '').trim() || `Lead #${leadId}`;
  const email = String(leadRow.email || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { created: false, reason: 'invalid_email' };
  }

  let phone = String(leadRow.phone || '').trim();
  if (phone.length < 3) phone = PLACEHOLDER_PHONE;

  const allowedTypes = new Set([
    'residential',
    'commercial',
    'property_manager',
    'investor',
    'builder',
  ]);
  let customer_type = opts.customer_type != null ? String(opts.customer_type).trim() : 'residential';
  if (!allowedTypes.has(customer_type)) customer_type = 'residential';

  const zipRaw = leadRow.zipcode != null ? String(leadRow.zipcode).replace(/\D/g, '').slice(0, 10) : '';
  const zipcode = zipRaw.length >= 5 ? zipRaw : null;
  const address =
    leadRow.address != null && String(leadRow.address).trim()
      ? String(leadRow.address).trim().slice(0, 500)
      : null;

  const noteAuto = `Convertido do lead #${leadId} (estágio: ${slug || '—'}).`;
  const noteLead = leadRow.notes != null ? String(leadRow.notes).trim().slice(0, 4000) : '';
  const notes = noteLead ? `${noteAuto}\n\n${noteLead}` : noteAuto;

  const owner_id =
    leadRow.owner_id != null && leadRow.owner_id !== '' ? parseInt(String(leadRow.owner_id), 10) : null;
  const ownerOk = Number.isFinite(owner_id) && owner_id > 0 ? owner_id : null;

  const base = {
    name: name.slice(0, 255),
    email: email.slice(0, 255),
    phone: phone.slice(0, 50),
    address,
    city: null,
    state: null,
    zipcode,
    customer_type,
    owner_id: ownerOk,
    notes,
    status: 'active',
  };

  if (hasLeadIdCol) {
    const [r] = await pool.execute(
      `INSERT INTO customers (name, email, phone, address, city, state, zipcode, customer_type, owner_id, notes, status, lead_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        base.name,
        base.email,
        base.phone,
        base.address,
        base.city,
        base.state,
        base.zipcode,
        base.customer_type,
        base.owner_id,
        base.notes,
        leadId,
      ]
    );
    return { created: true, customer_id: r.insertId };
  }

  const [r2] = await pool.execute(
    `INSERT INTO customers (name, email, phone, address, city, state, zipcode, customer_type, owner_id, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      base.name,
      base.email,
      base.phone,
      base.address,
      base.city,
      base.state,
      base.zipcode,
      base.customer_type,
      base.owner_id,
      base.notes,
    ]
  );
  return { created: true, customer_id: r2.insertId };
}
