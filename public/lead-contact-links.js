/**
 * Ligao telefnica e SMS nativos (tel:/sms:) para leads.
 */
(function (global) {
  const SMS_COMPANY = 'Senior Floors';

  function normalizePhoneDigits(phone) {
    const raw = String(phone || '').trim();
    if (!raw) return '';
    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return hasPlus ? '+' + digits : digits;
  }

  function isIosDevice() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  /** Corpo da mensagem SMS com primeiro nome do cliente. */
  function defaultLeadSmsBody(lead) {
    const full = lead && (lead.name || lead.full_name) ? String(lead.name || lead.full_name).trim() : '';
    const first = full.split(/\s+/).filter(Boolean)[0] || 'there';
    return `Olá ${first}, aqui é da ${SMS_COMPANY}. Como posso ajudar?`;
  }

  function buildTelHref(phone) {
    const num = normalizePhoneDigits(phone);
    return num ? `tel:${num}` : '';
  }

  function buildSmsHref(phone, body) {
    const num = normalizePhoneDigits(phone);
    if (!num) return '';
    const encoded = encodeURIComponent(body != null ? String(body) : '');
    const sep = isIosDevice() ? '&' : '?';
    return `sms:${num}${sep}body=${encoded}`;
  }

  function buildLeadSmsHref(lead, body) {
    const phone = lead && lead.phone;
    if (!phone) return '';
    return buildSmsHref(phone, body != null ? body : defaultLeadSmsBody(lead));
  }

  global.sfNormalizePhoneDigits = normalizePhoneDigits;
  global.sfDefaultLeadSmsBody = defaultLeadSmsBody;
  global.sfBuildTelHref = buildTelHref;
  global.sfBuildSmsHref = buildSmsHref;
  global.sfBuildLeadSmsHref = buildLeadSmsHref;
})(typeof window !== 'undefined' ? window : globalThis);
