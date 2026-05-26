/**
 * Native tel:/sms: links and stage-based SMS templates for leads.
 */
(function (global) {
  const SMS_COMPANY = 'Senior Floors';

  /** @type {Record<string, Array<{ id: string, label: string, template: string }>>} */
  const STAGE_SMS_TEMPLATES = {
    new_lead: [
      {
        id: 'new_lead_intro',
        label: 'New lead ù introduction',
        template:
          "Hi [name], thanks for reaching out to Senior Floors. I'd be happy to help. Can you tell me a little about the project?",
      },
    ],
    quote_sent: [
      {
        id: 'quote_sent_followup',
        label: 'Quote sent ù thank you',
        template:
          "Hello [name], thank you for your time today. I've sent email and attached the quote PDF with the options we discussed. Thank you!\n\nFor know more about us\nhttps://senior-floors.com/",
      },
    ],
    follow_up_1: [
      {
        id: 'follow_up_quote_reminder',
        label: 'Follow up ù quote reminder',
        template:
          "Hello [name], I hope all is well. Just following up on the quote I sent a few days ago. If everything looks good, I'd be happy to help get your project scheduled and reserve a spot for you.",
      },
      {
        id: 'follow_up_last_check',
        label: 'Follow up ù last check-in',
        template:
          "Hello [name], just wanted to check in one last time regarding your flooring project. If timing is better later, no problem at all ù I'd still be happy to help whenever you're ready.",
      },
    ],
  };

  function escapeHtml(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

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

  function leadFirstName(lead) {
    const full =
      lead && (lead.name || lead.full_name) ? String(lead.name || lead.full_name).trim() : '';
    return full.split(/\s+/).filter(Boolean)[0] || 'there';
  }

  function resolveLeadStageSlug(lead) {
    if (!lead) return '';
    const raw = String(lead.pipeline_stage_slug || lead.status || '').trim();
    if (typeof global.normalizePipelineSlug === 'function') {
      return global.normalizePipelineSlug(raw);
    }
    return raw;
  }

  function fillSmsTemplate(template, lead) {
    return String(template).replace(/\[name\]/gi, leadFirstName(lead));
  }

  function defaultLeadSmsBody(lead) {
    const first = leadFirstName(lead);
    return `Hi ${first}, this is ${SMS_COMPANY}. How can I help you today?`;
  }

  function getStageSmsDefinitions(slug) {
    return STAGE_SMS_TEMPLATES[slug] || null;
  }

  /**
   * @param {object} lead
   * @returns {Array<{ id: string, label: string, body: string, href: string }>}
   */
  function getLeadSmsOptions(lead) {
    if (!lead || !lead.phone) return [];
    const phone = lead.phone;
    const slug = resolveLeadStageSlug(lead);
    const defs = getStageSmsDefinitions(slug);
    const list =
      defs && defs.length
        ? defs
        : [{ id: 'default', label: 'Message', template: defaultLeadSmsBody(lead) }];
    return list
      .map((def) => {
        const body = defs ? fillSmsTemplate(def.template, lead) : defaultLeadSmsBody(lead);
        return {
          id: def.id,
          label: def.label,
          body,
          href: buildSmsHref(phone, body),
        };
      })
      .filter((o) => o.href);
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
    if (body != null) return buildSmsHref(phone, body);
    const opts = getLeadSmsOptions(lead);
    if (opts.length) return opts[0].href;
    return buildSmsHref(phone, defaultLeadSmsBody(lead));
  }

  let smsMenuEl = null;

  function closeSmsChoiceMenu() {
    if (smsMenuEl && smsMenuEl.parentNode) {
      smsMenuEl.parentNode.removeChild(smsMenuEl);
    }
    smsMenuEl = null;
    document.removeEventListener('click', onSmsMenuOutside, true);
    window.removeEventListener('resize', positionSmsMenu);
  }

  function positionSmsMenu() {
    if (!smsMenuEl || !smsMenuEl._anchor) return;
    const anchor = smsMenuEl._anchor;
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const belowTop = r.bottom + 4;
    const maxH = Math.min(320, window.innerHeight - belowTop - margin);
    smsMenuEl.style.position = 'fixed';
    smsMenuEl.style.left =
      Math.max(margin, Math.min(r.left, window.innerWidth - margin - Math.max(r.width, 260))) + 'px';
    smsMenuEl.style.top = belowTop + 'px';
    smsMenuEl.style.width = Math.max(r.width, 260) + 'px';
    smsMenuEl.style.maxHeight = Math.max(120, maxH) + 'px';
    smsMenuEl.style.overflowY = 'auto';
    smsMenuEl.style.zIndex = '25000';
  }

  function onSmsMenuOutside(e) {
    if (smsMenuEl && (e.target.closest('#sfSmsChoiceMenu') || e.target.closest('[data-lqs-sms-menu]') || e.target.closest('[data-sf-sms-picker-btn]'))) {
      return;
    }
    closeSmsChoiceMenu();
  }

  function openSmsChoiceMenu(anchorEl, lead) {
    if (!anchorEl || !lead) return;
    const options = getLeadSmsOptions(lead);
    if (!options.length) return;
    if (options.length === 1) {
      global.location.href = options[0].href;
      return;
    }
    closeSmsChoiceMenu();
    const menu = document.createElement('div');
    menu.id = 'sfSmsChoiceMenu';
    menu.className = 'lead-quick-sheet__status-menu lead-quick-sheet__sms-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = options
      .map(
        (o) =>
          `<a class="lead-quick-sheet__status-option lead-quick-sheet__sms-option" role="menuitem" href="${escapeAttr(
            o.href
          )}">${escapeHtml(o.label)}</a>`
      )
      .join('');
    menu._anchor = anchorEl;
    document.body.appendChild(menu);
    smsMenuEl = menu;
    positionSmsMenu();
    window.addEventListener('resize', positionSmsMenu);
    requestAnimationFrame(() => {
      document.addEventListener('click', onSmsMenuOutside, true);
    });
  }

  /**
   * @param {object} lead
   * @param {string} [buttonClass]
   * @param {object} [attrs] extra data-* attributes for picker button
   */
  function renderLeadSmsActionHtml(lead, buttonClass, attrs) {
    const opts = getLeadSmsOptions(lead);
    if (!opts.length) return '';
    const cls = buttonClass || 'lead-quick-sheet__action';
    if (opts.length === 1) {
      return `<a class="${cls}" href="${escapeAttr(opts[0].href)}">SMS</a>`;
    }
    const extra = attrs && typeof attrs === 'object' ? attrs : {};
    let dataAttrs = ' data-lqs-sms-menu data-sf-sms-picker-btn aria-haspopup="menu"';
    Object.keys(extra).forEach((k) => {
      dataAttrs += ` ${k}="${escapeAttr(extra[k])}"`;
    });
    return `<button type="button" class="${cls}"${dataAttrs}>SMS <span class="lead-quick-sheet__sms-chevron" aria-hidden="true">&#9662;</span></button>`;
  }

  global.sfNormalizePhoneDigits = normalizePhoneDigits;
  global.sfDefaultLeadSmsBody = defaultLeadSmsBody;
  global.sfResolveLeadStageSlug = resolveLeadStageSlug;
  global.sfGetLeadSmsOptions = getLeadSmsOptions;
  global.sfGetStageSmsDefinitions = getStageSmsDefinitions;
  global.sfFillSmsTemplate = fillSmsTemplate;
  global.sfBuildTelHref = buildTelHref;
  global.sfBuildSmsHref = buildSmsHref;
  global.sfBuildLeadSmsHref = buildLeadSmsHref;
  global.sfRenderLeadSmsActionHtml = renderLeadSmsActionHtml;
  global.sfOpenSmsChoiceMenu = openSmsChoiceMenu;
  global.sfCloseSmsChoiceMenu = closeSmsChoiceMenu;
  global.STAGE_SMS_TEMPLATES = STAGE_SMS_TEMPLATES;
})(typeof window !== 'undefined' ? window : globalThis);
