/**
 * Formato de evento de visita (browser) — manter alinhado com lib/leadVisitCalendarFormat.js
 */
(function (global) {
  'use strict';

  const SERVICE_FIELD_KEYS = new Set(['form_type', 'service_type', 'main_interest', 'property_type']);

  function norm(s) {
    return String(s || '')
      .trim()
      .toLowerCase();
  }

  function isServiceSlugText(text) {
    const t = String(text || '').trim();
    if (!t || t.length < 4) return false;
    if (/\s/.test(t) && !t.includes('_')) return false;
    return /^[a-z0-9][a-z0-9_&-]*$/i.test(t) && (t.includes('_') || t.includes('&'));
  }

  function resolveLeadCalendarOriginLabel(lead) {
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
    if (utm.includes('google') || utm === 'adwords' || src.includes('google') || /^google/i.test(platform)) {
      return 'Google';
    }
    const landing = String(lead.landing_page || '').trim();
    const formType = norm(lead.form_type);
    if (landing) return 'Google';
    if (formType && formType !== 'manual' && !formType.includes('facebook') && !formType.includes('meta')) {
      return 'Google';
    }
    return '';
  }

  function buildLeadVisitSummary(lead) {
    const name = (lead && lead.name ? String(lead.name) : 'Lead').trim() || 'Lead';
    const origin = resolveLeadCalendarOriginLabel(lead);
    return origin ? name + ' - ' + origin : name;
  }

  function buildLeadVisitDescription(lead) {
    const blocks = [];
    const contact = [];
    if (lead && lead.phone) contact.push('Tel: ' + String(lead.phone).trim());
    if (lead && lead.email) contact.push('Email: ' + String(lead.email).trim());
    const contactText = contact.join('\n').trim();
    if (contactText) blocks.push(contactText);

    const details = [];
    const msg = lead && lead.message ? String(lead.message).trim() : '';
    if (msg && !isServiceSlugText(msg)) details.push(msg);
    const notes = lead && lead.notes ? String(lead.notes).trim() : '';
    if (notes && notes !== msg) details.push(notes);
    const detailsText = details.join('\n\n').trim();
    if (detailsText) {
      if (blocks.length) blocks.push('????????????????');
      blocks.push(detailsText);
    }
    if (blocks.length) {
      blocks.push('????????????????');
      blocks.push('');
    }
    return blocks.join('\n').trimEnd();
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

  global.sfLeadVisitCalendarFormat = {
    resolveLeadCalendarOriginLabel,
    buildLeadVisitSummary,
    buildLeadVisitDescription,
    buildLeadVisitLocation,
    isServiceSlugText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
