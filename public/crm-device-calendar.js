/**
 * Abre o calendário nativo do dispositivo com um evento de visita pré-preenchido (ficheiro .ics).
 */
(function (global) {
  'use strict';

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

  /** Próximo slot :00 ou :30 a partir de agora. */
  function snapToNextHalfHour(fromDate) {
    const d = new Date(fromDate || Date.now());
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

  function buildLeadVisitLocation(lead) {
    if (!lead || typeof lead !== 'object') return '';
    const line1 = String(lead.address_line1 || lead.address || '').trim();
    const line2 = String(lead.address_line2 || '').trim();
    const city = String(lead.city || '').trim();
    const zip = String(lead.zipcode || lead.zip || '').trim();
    const parts = [line1, line2, city, zip].filter(Boolean);
    if (parts.length) return parts.join(', ');
    if (line1) return line1;
    return '';
  }

  function buildLeadVisitDescription(lead) {
    const lines = [];
    const name = lead && lead.name ? String(lead.name).trim() : '';
    if (name) lines.push('Cliente: ' + name);
    if (lead && lead.phone) lines.push('Tel: ' + String(lead.phone).trim());
    if (lead && lead.email) lines.push('Email: ' + String(lead.email).trim());
    if (lead && lead.id) lines.push('Lead #' + lead.id);
    try {
      const origin = global.location && global.location.origin ? global.location.origin : '';
      if (origin && lead && lead.id) {
        lines.push('CRM: ' + origin + '/lead-detail.html?id=' + encodeURIComponent(String(lead.id)));
      }
    } catch (_) {}
    if (lead && lead.notes) lines.push(String(lead.notes).trim());
    if (lead && lead.message) lines.push(String(lead.message).trim());
    return lines.filter(Boolean).join('\n');
  }

  /**
   * @param {object} lead
   * @param {{ start?: Date, durationMinutes?: number }} [options]
   * @returns {string}
   */
  function buildLeadVisitIcs(lead, options) {
    const opts = options || {};
    const start = opts.start instanceof Date ? opts.start : snapToNextHalfHour();
    const durationMinutes =
      typeof opts.durationMinutes === 'number' && opts.durationMinutes > 0 ? opts.durationMinutes : 60;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const name = (lead && lead.name ? String(lead.name) : 'Lead').trim() || 'Lead';
    const uid =
      'lead-visit-' +
      (lead && lead.id ? String(lead.id) : '0') +
      '-' +
      Date.now() +
      '@seniorfloors-crm';

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
      'DESCRIPTION:' + escapeIcsText(buildLeadVisitDescription(lead)),
      'STATUS:TENTATIVE',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return lines.join('\r\n');
  }

  /**
   * Dispara download/abertura do .ics no calendário padrão do sistema.
   * @param {object} lead
   * @param {{ start?: Date, durationMinutes?: number }} [options]
   * @returns {boolean}
   */
  function openLeadVisitInDeviceCalendar(lead, options) {
    if (!lead) return false;
    const ics = buildLeadVisitIcs(lead, options);
    const safeId = lead.id != null ? String(lead.id).replace(/[^\w-]/g, '') : 'lead';
    const filename = 'visita-lead-' + safeId + '.ics';

    try {
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const ua = navigator.userAgent || '';
      const isIos =
        /iPad|iPhone|iPod/i.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (isIos) {
        const opened = window.open(url, '_blank');
        if (!opened) window.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }, 60000);
      return true;
    } catch (err) {
      console.warn('[crm-device-calendar]', err);
      return false;
    }
  }

  global.sfBuildLeadVisitIcs = buildLeadVisitIcs;
  global.sfOpenLeadVisitInDeviceCalendar = openLeadVisitInDeviceCalendar;
  global.sfSnapVisitToNextHalfHour = snapToNextHalfHour;
})(typeof window !== 'undefined' ? window : globalThis);
