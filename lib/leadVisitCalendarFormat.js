/**
 * Formata titulo e descricao de visita para calendario (ICS / Google Calendar).
 */

export function snapToNextHalfHour(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m === 0 || m === 30) return d;
  if (m < 30) d.setMinutes(30);
  else {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
  }
  return d;
}

const SERVICE_FIELD_KEYS = new Set([
  'form_type',
  'service_type',
  'main_interest',
  'property_type',
]);

/** Linha separadora na descricao do evento */
export const CALENDAR_DESC_SEPARATOR = '\n\n????????????????\n\n';

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/** Slugs tecnicos do formulario (ex. hardwood_floor_sanding_&_refinishing). */
export function isServiceSlugText(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  if (/\s/.test(t) && !t.includes('_')) return false;
  return /^[a-z0-9][a-z0-9_&-]*$/i.test(t) && (t.includes('_') || t.includes('&'));
}

function fieldValueLooksLikeServiceSlug(lead, key) {
  if (!lead || !SERVICE_FIELD_KEYS.has(key)) return false;
  return isServiceSlugText(lead[key]);
}

/**
 * Origem para o titulo: Meta (Facebook) ou Google (LP / Google Ads).
 * @param {object} lead
 * @returns {'Meta'|'Google'|''}
 */
export function resolveLeadCalendarOriginLabel(lead) {
  if (!lead || typeof lead !== 'object') return '';

  const platform = String(lead.marketing_platform || '').trim();
  if (/^meta$/i.test(platform)) return 'Meta';
  if (/^google$/i.test(platform)) return 'Google';

  if (String(lead.fbclid || '').trim()) return 'Meta';

  const utm = norm(lead.utm_source);
  const src = norm(lead.source);
  const medium = norm(lead.utm_medium);

  if (
    utm.includes('facebook') ||
    utm.includes('instagram') ||
    utm === 'fb' ||
    utm.includes('meta') ||
    medium.includes('facebook') ||
    src.includes('facebook') ||
    src.includes('instagram') ||
    src.includes('meta')
  ) {
    return 'Meta';
  }

  if (String(lead.gclid || '').trim()) return 'Google';

  if (
    utm.includes('google') ||
    utm === 'adwords' ||
    src.includes('google') ||
    /^google/i.test(platform)
  ) {
    return 'Google';
  }

  const landing = String(lead.landing_page || '').trim();
  const formType = norm(lead.form_type);
  if (landing) return 'Google';
  if (
    formType &&
    formType !== 'manual' &&
    !formType.includes('facebook') &&
    !formType.includes('meta')
  ) {
    return 'Google';
  }

  return '';
}

/**
 * Titulo do evento: [nome] - [origem]
 * @param {object} lead
 */
export function buildLeadVisitSummary(lead) {
  const name = (lead?.name ? String(lead.name) : 'Lead').trim() || 'Lead';
  const origin = resolveLeadCalendarOriginLabel(lead);
  return origin ? `${name} - ${origin}` : name;
}

function appendBlock(blocks, lines) {
  const text = lines.filter(Boolean).join('\n').trim();
  if (text) blocks.push(text);
}

/**
 * Descricao do evento (sem link CRM, sem tipo de servico slug).
 * @param {object} lead
 */
export function buildLeadVisitDescription(lead) {
  const blocks = [];

  const contact = [];
  if (lead?.phone) contact.push('Tel: ' + String(lead.phone).trim());
  if (lead?.email) contact.push('Email: ' + String(lead.email).trim());
  appendBlock(blocks, contact);

  const details = [];
  const msg = lead?.message ? String(lead.message).trim() : '';
  if (msg && !isServiceSlugText(msg) && !fieldValueLooksLikeServiceSlug(lead, 'form_type')) {
    details.push(msg);
  }
  const notes = lead?.notes ? String(lead.notes).trim() : '';
  if (notes && notes !== msg) details.push(notes);

  if (details.length) {
    if (blocks.length) blocks.push('????????????????');
    appendBlock(blocks, details);
  }

  if (blocks.length) {
    blocks.push('????????????????');
    blocks.push('');
  }

  return blocks.join('\n').trimEnd();
}

export function buildLeadVisitLocation(lead) {
  if (!lead || typeof lead !== 'object') return '';
  const line1 = String(lead.address_line1 || lead.address || '').trim();
  const line2 = String(lead.address_line2 || '').trim();
  const city = String(lead.city || '').trim();
  const zip = String(lead.zipcode || lead.zip || '').trim();
  const parts = [line1, line2, city, zip].filter(Boolean);
  return parts.length ? parts.join(', ') : line1;
}
