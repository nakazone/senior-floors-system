/**
 * Gera ficheiro iCalendar (.ics) para visita de lead.
 */

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatIcsLocalDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

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

export function buildLeadVisitLocation(lead) {
  if (!lead || typeof lead !== 'object') return '';
  const line1 = String(lead.address_line1 || lead.address || '').trim();
  const line2 = String(lead.address_line2 || '').trim();
  const city = String(lead.city || '').trim();
  const zip = String(lead.zipcode || lead.zip || '').trim();
  const parts = [line1, line2, city, zip].filter(Boolean);
  return parts.length ? parts.join(', ') : line1;
}

export function buildLeadVisitDescription(lead, crmOrigin) {
  const lines = [];
  const name = lead && lead.name ? String(lead.name).trim() : '';
  if (name) lines.push('Cliente: ' + name);
  if (lead?.phone) lines.push('Tel: ' + String(lead.phone).trim());
  if (lead?.email) lines.push('Email: ' + String(lead.email).trim());
  if (lead?.id) lines.push('Lead #' + lead.id);
  const origin = crmOrigin ? String(crmOrigin).replace(/\/$/, '') : '';
  if (origin && lead?.id) {
    lines.push('CRM: ' + origin + '/lead-detail.html?id=' + encodeURIComponent(String(lead.id)));
  }
  if (lead?.notes) lines.push(String(lead.notes).trim());
  if (lead?.message) lines.push(String(lead.message).trim());
  return lines.filter(Boolean).join('\n');
}

/**
 * @param {object} lead
 * @param {{ start?: Date, durationMinutes?: number, crmOrigin?: string }} [options]
 */
export function buildLeadVisitIcs(lead, options = {}) {
  const start = options.start instanceof Date ? options.start : snapToNextHalfHour();
  const durationMinutes =
    typeof options.durationMinutes === 'number' && options.durationMinutes > 0
      ? options.durationMinutes
      : 60;
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const name = (lead?.name ? String(lead.name) : 'Lead').trim() || 'Lead';
  const uid =
    'lead-visit-' + (lead?.id ? String(lead.id) : '0') + '-' + Date.now() + '@seniorfloors-crm';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Senior Floors CRM//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + formatIcsLocalDateTime(new Date()),
    'DTSTART:' + formatIcsLocalDateTime(start),
    'DTEND:' + formatIcsLocalDateTime(end),
    'SUMMARY:' + escapeIcsText('Visita — ' + name),
    'LOCATION:' + escapeIcsText(buildLeadVisitLocation(lead)),
    'DESCRIPTION:' + escapeIcsText(buildLeadVisitDescription(lead, options.crmOrigin)),
    'STATUS:TENTATIVE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
