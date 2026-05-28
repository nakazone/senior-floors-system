/**
 * Abre o calendario nativo do dispositivo com evento de visita pre-preenchido.
 * Android: Google Calendar (app). iOS/desktop: .ics inline via API (sem download forcado).
 */
(function (global) {
  'use strict';

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

  function formatGoogleCalendarDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      '00'
    );
  }

  function buildLeadVisitLocation(lead) {
    if (!lead || typeof lead !== 'object') return '';
    const line1 = String(lead.address_line1 || lead.address || '').trim();
    const line2 = String(lead.address_line2 || '').trim();
    const city = String(lead.city || '').trim();
    const zip = String(lead.zipcode || lead.zip || '').trim();
    const parts = [line1, line2, city, zip].filter(Boolean);
    return parts.length ? parts.join(', ') : line1;
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
        lines.push(origin + '/lead-detail.html?id=' + encodeURIComponent(String(lead.id)));
      }
    } catch (_) {}
    if (lead && lead.notes) lines.push(String(lead.notes).trim());
    if (lead && lead.message) lines.push(String(lead.message).trim());
    return lines.filter(Boolean).join('\n');
  }

  function buildGoogleCalendarUrl(lead, options) {
    const opts = options || {};
    const start = opts.start instanceof Date ? opts.start : snapToNextHalfHour();
    const durationMinutes =
      typeof opts.durationMinutes === 'number' && opts.durationMinutes > 0 ? opts.durationMinutes : 60;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const name = (lead && lead.name ? String(lead.name) : 'Lead').trim() || 'Lead';
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: 'Visita — ' + name,
      dates: formatGoogleCalendarDate(start) + '/' + formatGoogleCalendarDate(end),
      details: buildLeadVisitDescription(lead),
      location: buildLeadVisitLocation(lead),
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function isAndroidDevice() {
    return /Android/i.test(navigator.userAgent || '');
  }

  function isIosDevice() {
    const ua = navigator.userAgent || '';
    return (
      /iPad|iPhone|iPod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  function openIcsViaApi(leadId) {
    const url = '/api/leads/' + encodeURIComponent(String(leadId)) + '/calendar.ics';

    if (isIosDevice()) {
      // Nova aba: Safari mostra "Adicionar ao Calendario" em vez de guardar ficheiro
      const opened = window.open(url, '_blank', 'noopener');
      if (!opened) {
        global.location.href = url;
      }
      return true;
    }

    // Desktop / outros: navegar na mesma janela abre handler .ics do SO
    global.location.href = url;
    return true;
  }

  /**
   * @param {object} lead
   * @param {{ start?: Date, durationMinutes?: number }} [options]
   * @returns {boolean}
   */
  function openLeadVisitInDeviceCalendar(lead, options) {
    if (!lead) return false;

    try {
      if (isAndroidDevice()) {
        global.location.href = buildGoogleCalendarUrl(lead, options);
        return true;
      }

      if (lead.id != null && lead.id !== '') {
        return openIcsViaApi(lead.id);
      }

      // Fallback sem ID: data URI (sem atributo download)
      if (typeof global.sfBuildLeadVisitIcs === 'function') {
        const ics = global.sfBuildLeadVisitIcs(lead, options);
        const dataUrl = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
        global.location.href = dataUrl;
        return true;
      }
    } catch (err) {
      console.warn('[crm-device-calendar]', err);
    }
    return false;
  }

  global.sfOpenLeadVisitInDeviceCalendar = openLeadVisitInDeviceCalendar;
  global.sfBuildGoogleCalendarVisitUrl = buildGoogleCalendarUrl;
  global.sfSnapVisitToNextHalfHour = snapToNextHalfHour;
})(typeof window !== 'undefined' ? window : globalThis);
