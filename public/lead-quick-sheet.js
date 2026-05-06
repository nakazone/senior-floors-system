/**
 * Bottom sheet estilo Google Calendar (mobile) para prù-visualizar o lead no dashboard.
 */
(function (global) {
  function escapeHtml(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return 'ù';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return escapeHtml(String(iso));
      return escapeHtml(d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    } catch {
      return escapeHtml(String(iso));
    }
  }

  function fmtMoney(n) {
    if (n == null || n === '') return 'ù';
    const x = parseFloat(n);
    if (Number.isNaN(x)) return escapeHtml(String(n));
    return escapeHtml(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(x)
    );
  }

  const DETAIL_LABELS = {
    email: 'Email',
    phone: 'Telefone',
    zipcode: 'CEP',
    message: 'Mensagem',
    notes: 'Notas',
    source: 'Origem',
    status: 'Status',
    priority: 'Prioridade',
    estimated_value: 'Valor estimado',
    created_at: 'Criado em',
    updated_at: 'Atualizado em',
    owner_name: 'Responsùvel',
    owner_email: 'Email do responsùvel',
    pipeline_stage_name: 'Estùgio',
    pipeline_stage_slug: 'Estùgio (slug)',
    form_type: 'Tipo de formulùrio',
    next_steps: 'Prùximos passos',
    next_steps_notes: 'Notas prùximos passos',
    utm_source: 'UTM source',
    utm_medium: 'UTM medium',
    utm_campaign: 'UTM campaign',
    utm_term: 'UTM term',
    utm_content: 'UTM content',
    marketing_platform: 'Plataforma marketing',
    gclid: 'gclid',
    fbclid: 'fbclid',
    landing_page: 'Landing page',
    referrer_url: 'Referrer',
    city: 'Cidade',
    state: 'Estado',
    address: 'Morada',
    company_name: 'Empresa',
    job_title: 'Cargo',
  };

  const SKIP_KEYS = new Set([
    'id',
    'owner_id',
    'pipeline_stage_id',
    'pipeline_stage_color',
    'created_by',
    'updated_by',
  ]);

  function stageDisplayName(lead) {
    const slug = lead.pipeline_stage_slug || lead.status || '';
    const name = lead.pipeline_stage_name;
    if (typeof global.pipelineStageDisplayName === 'function') {
      return global.pipelineStageDisplayName(slug, name);
    }
    return name || slug || 'ù';
  }

  function formatFieldValue(key, val) {
    if (key === 'estimated_value') return fmtMoney(val);
    if (/_at$/.test(key) || key === 'due_date') return fmtDate(val);
    return escapeHtml(String(val));
  }

  function renderLeadFields(lead) {
    const ORDER = [
      'owner_name',
      'owner_email',
      'pipeline_stage_name',
      'status',
      'priority',
      'email',
      'phone',
      'zipcode',
      'estimated_value',
      'source',
      'form_type',
      'next_steps',
      'next_steps_notes',
      'message',
      'notes',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'marketing_platform',
      'gclid',
      'fbclid',
      'landing_page',
      'referrer_url',
      'company_name',
      'job_title',
      'city',
      'state',
      'address',
      'created_at',
      'updated_at',
    ];

    const seen = new Set();
    const rows = [];

    function pushField(key, labelOverride) {
      if (SKIP_KEYS.has(key)) return;
      const val = lead[key];
      if (val == null || val === '') return;
      if (typeof val === 'object') return;
      const str = String(val).trim();
      if (!str) return;
      const label = labelOverride || DETAIL_LABELS[key] || key.replace(/_/g, ' ');
      rows.push(
        `<div class="lead-quick-sheet__row"><dt>${escapeHtml(label)}</dt><dd>${formatFieldValue(key, val)}</dd></div>`
      );
      seen.add(key);
    }

    ORDER.forEach((k) => pushField(k));
    Object.keys(lead).forEach((k) => {
      if (seen.has(k)) return;
      if (SKIP_KEYS.has(k)) return;
      if (k.startsWith('pipeline_stage_') && k !== 'pipeline_stage_name') return;
      pushField(k);
    });

    if (!rows.length) {
      return '<p class="lead-quick-sheet__empty">Sem campos adicionais.</p>';
    }
    return `<dl class="lead-quick-sheet__dl">${rows.join('')}</dl>`;
  }

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, data: j };
  }

  function renderFollowups(list) {
    if (!list || !list.length)
      return '<p class="lead-quick-sheet__empty">Sem follow-ups.</p>';
    return `<ul class="lead-quick-sheet__list">${list
      .map((f) => {
        const title = escapeHtml(f.title || 'Tarefa');
        const due = f.due_date ? fmtDate(f.due_date) : 'ù';
        const who = f.assigned_to_name ? escapeHtml(f.assigned_to_name) : '';
        const pri = f.priority ? escapeHtml(f.priority) : '';
        const bits = [due, who, pri].filter(Boolean).join(' ù ');
        return `<li class="lead-quick-sheet__list-item"><div class="lead-quick-sheet__list-title">${title}</div><div class="lead-quick-sheet__muted">${bits}</div></li>`;
      })
      .join('')}</ul>`;
  }

  function buildAddressFromVisit(v) {
    if (v.address && String(v.address).trim()) return String(v.address).trim();
    const parts = [v.address_line1, v.city, v.zipcode].filter(Boolean).map(String).map((s) => s.trim());
    return parts.join(', ');
  }

  function renderVisits(list) {
    if (!list || !list.length)
      return '<p class="lead-quick-sheet__empty">Sem visitas agendadas.</p>';
    return `<ul class="lead-quick-sheet__list">${list
      .map((v) => {
        const when = v.scheduled_at ? fmtDate(v.scheduled_at) : 'ù';
        const st = v.status ? escapeHtml(v.status) : '';
        const addr = escapeHtml(buildAddressFromVisit(v));
        const asn = v.assigned_to_name ? escapeHtml(v.assigned_to_name) : '';
        const meta = [st, addr, asn].filter(Boolean).join(' ù ');
        return `<li class="lead-quick-sheet__list-item"><div class="lead-quick-sheet__list-title">${when}</div><div class="lead-quick-sheet__muted">${meta || 'ù'}</div></li>`;
      })
      .join('')}</ul>`;
  }

  async function openLeadQuickSheet(id) {
    const sid = parseInt(id, 10);
    if (!Number.isFinite(sid)) return;
    const root = document.getElementById('leadQuickSheet');
    const body = document.getElementById('leadQuickSheetBody');
    const titleEl = document.getElementById('leadQuickSheetTitle');
    const badgesEl = document.getElementById('leadQuickSheetBadges');
    const fullLink = document.getElementById('leadQuickSheetFullLink');
    if (!root || !body || !titleEl || !badgesEl) {
      window.location.href = 'lead-detail.html?id=' + sid;
      return;
    }

    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lead-quick-sheet-open');
    body.innerHTML = '<div class="lead-quick-sheet__loading">A carregarù</div>';
    if (fullLink) fullLink.href = 'lead-detail.html?id=' + sid;

    const [leadRes, fuRes, viRes] = await Promise.all([
      fetchJson('/api/leads/' + sid),
      fetchJson('/api/leads/' + sid + '/followups'),
      fetchJson('/api/visits?lead_id=' + encodeURIComponent(String(sid)) + '&limit=30'),
    ]);

    const ld = leadRes.data;
    if (!leadRes.ok || !ld || ld.success !== true || !ld.data) {
      body.innerHTML =
        '<p class="lead-quick-sheet__error">Nùo foi possùvel carregar o lead.</p>';
      return;
    }

    const lead = ld.data;
    titleEl.textContent = lead.name || 'Lead';

    const stageLabel = stageDisplayName(lead);
    const pri = String(lead.priority || 'medium').toLowerCase().replace(/[^a-z]/g, '') || 'medium';
    badgesEl.innerHTML =
      `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--stage">${escapeHtml(stageLabel)}</span>` +
      `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--pri lead-quick-sheet__badge--pri-${escapeHtml(pri)}">${escapeHtml(lead.priority || 'medium')}</span>`;

    const tel = lead.phone
      ? `<a class="lead-quick-sheet__action" href="tel:${encodeURIComponent(String(lead.phone))}">Ligar</a>`
      : '';
    const mail = lead.email
      ? `<a class="lead-quick-sheet__action" href="mailto:${escapeHtml(lead.email)}">Email</a>`
      : '';

    const followups =
      fuRes.ok && fuRes.data && fuRes.data.success && Array.isArray(fuRes.data.data)
        ? fuRes.data.data
        : [];
    const visits =
      viRes.ok && viRes.data && viRes.data.success && Array.isArray(viRes.data.data)
        ? viRes.data.data
        : [];

    body.innerHTML = `
      <div class="lead-quick-sheet__toolbar">${tel}${mail}</div>
      <section class="lead-quick-sheet__section">
        <h3 class="lead-quick-sheet__h3">Detalhes</h3>
        ${renderLeadFields(lead)}
      </section>
      <section class="lead-quick-sheet__section">
        <h3 class="lead-quick-sheet__h3">Follow-ups</h3>
        ${renderFollowups(followups)}
      </section>
      <section class="lead-quick-sheet__section">
        <h3 class="lead-quick-sheet__h3">Visitas</h3>
        ${renderVisits(visits)}
      </section>
    `;
  }

  function closeLeadQuickSheet() {
    const root = document.getElementById('leadQuickSheet');
    if (!root) return;
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lead-quick-sheet-open');
  }

  function wire() {
    const root = document.getElementById('leadQuickSheet');
    if (!root) return;
    const bd = document.getElementById('leadQuickSheetBackdrop');
    const closeBtn = document.getElementById('leadQuickSheetClose');
    if (bd) bd.addEventListener('click', closeLeadQuickSheet);
    if (closeBtn) closeBtn.addEventListener('click', closeLeadQuickSheet);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('is-open')) closeLeadQuickSheet();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  global.openLeadQuickSheet = openLeadQuickSheet;
  global.closeLeadQuickSheet = closeLeadQuickSheet;

  const origViewLead = typeof global.viewLead === 'function' ? global.viewLead : null;
  global.viewLead = function (id) {
    const root = document.getElementById('leadQuickSheet');
    if (root && typeof openLeadQuickSheet === 'function') {
      void openLeadQuickSheet(id);
    } else if (origViewLead) {
      origViewLead(id);
    } else {
      window.location.href = 'lead-detail.html?id=' + encodeURIComponent(id);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
