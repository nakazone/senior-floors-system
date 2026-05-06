/**
 * Painel rapido do lead no dashboard (popup centrado + animacao FLIP a partir do cartao Kanban).
 * Resumo estatico sempre visivel; estagio/prioridade; botao Agendar visita; orcamentos.
 */
(function (global) {
  let sheetLeadId = null;
  let sheetAnchorEl = null;
  /** @type {Record<string, unknown> | null} */
  let sheetLead = null;
  /** Cache dos estagios do pipeline (com cores), alinhado ao Kanban */
  let sheetStagesCache = [];

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
    owner_name: 'Responsavel',
    owner_email: 'Email do responsavel',
    pipeline_stage_name: 'Estagio',
    pipeline_stage_slug: 'Estagio (slug)',
    form_type: 'Tipo de formulario',
    next_steps: 'Proximos passos',
    next_steps_notes: 'Notas proximos passos',
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

  /** Omitir duplicados do bloco principal do resumo */
  const EXTRA_SKIP = new Set([
    'name',
    'email',
    'phone',
    'zipcode',
    'address',
    'notes',
    'priority',
    'estimated_value',
    'status',
    'pipeline_stage_name',
    'pipeline_stage_slug',
    'next_steps',
    'next_steps_notes',
    'owner_name',
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

  function ddStatic(label, innerHtml) {
    return `<div class="lead-quick-sheet__row"><dt>${escapeHtml(label)}</dt><dd>${innerHtml}</dd></div>`;
  }

  /** Resumo principal: sempre visivel, somente leitura */
  function renderPrimaryStaticSummary(lead) {
    const nextBits = [lead.next_steps, lead.next_steps_notes].filter((x) => x != null && String(x).trim());
    const nextStr = nextBits.length ? escapeHtml(nextBits.join(' ù ')) : 'ù';
    const parts = [
      ddStatic('Nome', lead.name ? escapeHtml(String(lead.name)) : 'ù'),
      ddStatic('Email', lead.email ? escapeHtml(String(lead.email)) : 'ù'),
      ddStatic('Telefone', lead.phone ? escapeHtml(String(lead.phone)) : 'ù'),
      ddStatic('Morada', lead.address != null && String(lead.address).trim() ? escapeHtml(String(lead.address)) : 'ù'),
      ddStatic('CEP', lead.zipcode ? escapeHtml(String(lead.zipcode)) : 'ù'),
      ddStatic('Valor estimado', formatFieldValue('estimated_value', lead.estimated_value)),
      ddStatic('Notas', lead.notes != null && String(lead.notes).trim() ? escapeHtml(String(lead.notes)) : 'ù'),
      ddStatic('Proximos passos', nextStr),
      ddStatic(
        'Responsavel',
        lead.owner_name ? escapeHtml(String(lead.owner_name)) : 'ù'
      ),
    ];
    return `<dl class="lead-quick-sheet__dl lead-quick-sheet__dl--primary">${parts.join('')}</dl>`;
  }

  function renderLeadCatalogFields(lead) {
    const ORDER = [
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
      'message',
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
      if (SKIP_KEYS.has(key) || EXTRA_SKIP.has(key)) return;
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
      if (SKIP_KEYS.has(k) || EXTRA_SKIP.has(k)) return;
      if (k.startsWith('pipeline_stage_') && k !== 'pipeline_stage_name') return;
      pushField(k);
    });

    if (!rows.length) {
      return '';
    }
    return `<h4 class="lead-quick-sheet__h4">Mais detalhes</h4><dl class="lead-quick-sheet__dl">${rows.join('')}</dl>`;
  }

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, data: j };
  }

  function notifySheet(msg, kind) {
    if (typeof global.crmNotify === 'function') global.crmNotify(msg, kind || 'info');
    else if (kind === 'error') alert(msg);
  }

  function maybeRefreshKanban() {
    if (typeof global.loadKanbanBoard === 'function') {
      try {
        void global.loadKanbanBoard();
      } catch (_) {}
    }
  }

  const DEFAULT_STAGES = [
    { id: 1, name: 'Novo lead', slug: 'new_lead' },
    { id: 2, name: 'Contato realizado', slug: 'contacted' },
    { id: 3, name: 'Reuniao agendada', slug: 'meeting_scheduled' },
    { id: 4, name: 'Orcamento enviado', slug: 'quote_sent' },
    { id: 5, name: 'Follow-up 1', slug: 'follow_up_1' },
    { id: 6, name: 'Follow-up 2', slug: 'follow_up_2' },
    { id: 7, name: 'Tentativa de fechamento', slug: 'closing_attempt' },
    { id: 8, name: 'Ganho', slug: 'won' },
    { id: 9, name: 'Perdido', slug: 'lost' },
  ];

  function normalizeStages(stagesRes) {
    let apiRows = [];
    try {
      const payload = stagesRes && stagesRes.data;
      if (payload && payload.success && Array.isArray(payload.data)) {
        apiRows = payload.data;
      }
    } catch (_) {}
    if (typeof global.mergePipelineStagesForKanban === 'function') {
      return global.mergePipelineStagesForKanban(apiRows);
    }
    const defs = global.PIPELINE_V9_KANBAN_DEFAULTS || {};
    return DEFAULT_STAGES.map((s, i) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      color: (defs[s.slug] && defs[s.slug].color) || '#64748b',
      order_num: i + 1,
      is_active: 1,
    }));
  }

  function slugMatchesCurrent(stageSlug, currentSlug) {
    const a = String(stageSlug || '').trim();
    const b = String(currentSlug || '').trim();
    if (typeof global.normalizePipelineSlug === 'function') {
      return global.normalizePipelineSlug(a) === global.normalizePipelineSlug(b);
    }
    return a === b;
  }

  function renderStageOptions(stages, currentSlug) {
    return stages
      .map((stage) => {
        const slug = stage.slug;
        const label =
          typeof global.pipelineStageDisplayName === 'function'
            ? global.pipelineStageDisplayName(slug, stage.name)
            : stage.name || slug;
        const sel = slugMatchesCurrent(slug, currentSlug) ? ' selected' : '';
        const col = escapeHtml(stage.color || '#94a3b8');
        return `<option value="${escapeHtml(slug)}" data-color="${col}"${sel}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function syncStatusDotFromSelect() {
    const sel = document.getElementById('lqsStatus');
    const dot = document.getElementById('lqsStatusDot');
    if (!sel || !dot) return;
    const opt = sel.options[sel.selectedIndex];
    const c = opt && opt.getAttribute('data-color');
    const hex = c || '#94a3b8';
    dot.style.backgroundColor = hex;
    sel.style.accentColor = hex;
  }

  function stageColorForLead(lead, stages) {
    const slug = lead.pipeline_stage_slug || lead.status || '';
    const list = stages || sheetStagesCache;
    const hit = list.find((s) => slugMatchesCurrent(s.slug, slug));
    return (hit && hit.color) || '#64748b';
  }

  function mergeQuoteRows(quotesData, proposalsData) {
    const quotes =
      quotesData && quotesData.success && Array.isArray(quotesData.data) ? quotesData.data : [];
    const proposals =
      proposalsData && proposalsData.success && Array.isArray(proposalsData.data) ? proposalsData.data : [];
    const rows = [];
    quotes.forEach((q) => {
      rows.push({
        kind: 'quote',
        id: q.id,
        label: q.quote_number || `Quote #${q.id}`,
        amount: q.total_amount,
        status: q.status || 'draft',
        created_at: q.created_at,
        expires: q.expiration_date,
        pdfUrl:
          q.pdf_path || q.has_invoice_pdf ? `/api/quotes/${q.id}/invoice-pdf` : null,
      });
    });
    proposals.forEach((p) => {
      rows.push({
        kind: 'proposal',
        id: p.id,
        label: p.proposal_number || `Proposta #${p.id}`,
        amount: p.total_value,
        status: p.status || 'draft',
        created_at: p.created_at,
        expires: null,
        pdfUrl: null,
      });
    });
    rows.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return rows;
  }

  function renderQuotesRows(rows, sid) {
    if (!rows.length) {
      return `<p class="lead-quick-sheet__empty">Nenhum orcamento ligado a este lead.</p>
        <p class="lead-quick-sheet__hint">Use <strong>Novo orcamento</strong> na barra superior.</p>`;
    }
    return rows
      .map((row) => {
        const badge =
          row.kind === 'quote'
            ? '<span class="lead-quick-sheet__qbadge lead-quick-sheet__qbadge--quote">Quote</span>'
            : '<span class="lead-quick-sheet__qbadge lead-quick-sheet__qbadge--proposal">Proposta</span>';
        const when = row.created_at ? new Date(row.created_at).toLocaleDateString('pt-BR') : 'ù';
        const exp =
          row.expires && row.kind === 'quote'
            ? `<p class="lead-quick-sheet__qmeta"><strong>Expira:</strong> ${escapeHtml(
                new Date(row.expires).toLocaleDateString('pt-BR')
              )}</p>`
            : '';
        const editHref =
          row.kind === 'quote'
            ? `quote-builder.html?id=${encodeURIComponent(String(row.id))}&lead_id=${encodeURIComponent(String(sid))}`
            : '#';
        const pdfBtn = row.pdfUrl
          ? `<a class="lead-quick-sheet__btn-sm" href="${row.pdfUrl}" target="_blank" rel="noopener">PDF</a>`
          : '';
        const editBtn =
          row.kind === 'quote'
            ? `<a class="lead-quick-sheet__btn-sm lead-quick-sheet__btn-sm--primary" href="${editHref}">Abrir</a>`
            : '';
        const delBtn =
          row.kind === 'quote'
            ? `<button type="button" class="lead-quick-sheet__btn-sm lead-quick-sheet__btn-sm--danger" data-lqs-delete-quote="${row.id}">Excluir</button>`
            : '';
        return `<div class="lead-quick-sheet__qcard" data-quote-row="${row.kind}-${row.id}">
          <div class="lead-quick-sheet__qhead"><h4 class="lead-quick-sheet__qh4">${escapeHtml(row.label)}</h4>${badge}</div>
          <p class="lead-quick-sheet__qmeta"><strong>Valor:</strong> $${parseFloat(row.amount || 0).toLocaleString()}</p>
          <p class="lead-quick-sheet__qmeta"><strong>Status:</strong> ${escapeHtml(String(row.status))}</p>
          <p class="lead-quick-sheet__qmeta"><strong>Criada:</strong> ${escapeHtml(when)}</p>
          ${exp}
          <div class="lead-quick-sheet__qactions">${pdfBtn}${editBtn}${delBtn}
            <button type="button" class="lead-quick-sheet__btn-sm" data-lqs-open-quotes-crm>Quotes CRM</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function updateHeaderBadges(lead) {
    const badgesEl = document.getElementById('leadQuickSheetBadges');
    if (!badgesEl || !lead) return;
    const stageLabel = stageDisplayName(lead);
    const pri = String(lead.priority || 'medium').toLowerCase().replace(/[^a-z]/g, '') || 'medium';
    const stageHex = escapeHtml(stageColorForLead(lead, sheetStagesCache));
    badgesEl.innerHTML =
      `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--stage" style="--lqs-stage:${stageHex}">${escapeHtml(stageLabel)}</span>` +
      `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--pri lead-quick-sheet__badge--pri-${escapeHtml(pri)}">${escapeHtml(lead.priority || 'medium')}</span>`;
  }

  async function patchLead(partial) {
    if (!sheetLeadId) return null;
    try {
      const r = await fetch(`/api/leads/${sheetLeadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(partial),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) {
        notifySheet(data.error || 'Nao foi possivel atualizar o lead.', 'error');
        return null;
      }
      if (data.data) {
        sheetLead = data.data;
        updateHeaderBadges(sheetLead);
      }
      maybeRefreshKanban();
      return data;
    } catch (e) {
      notifySheet(e.message || 'Erro de rede', 'error');
      return null;
    }
  }

  async function refreshQuotesOnly() {
    if (!sheetLeadId) return;
    const [quotesRes, proposalsRes] = await Promise.all([
      fetchJson('/api/quotes?lead_id=' + encodeURIComponent(String(sheetLeadId)) + '&limit=50'),
      fetchJson('/api/leads/' + sheetLeadId + '/proposals'),
    ]);
    const rows = mergeQuoteRows(
      quotesRes.ok ? quotesRes.data : {},
      proposalsRes.ok ? proposalsRes.data : {}
    );
    const mount = document.querySelector('[data-lqs-quotes-list]');
    if (mount) mount.innerHTML = renderQuotesRows(rows, sheetLeadId);
  }

  function renderSheetBody(lead, bundle) {
    const sid = sheetLeadId;
    const stages = bundle.stages;
    const currentSlug = lead.status || '';
    const pri = String(lead.priority || 'medium').toLowerCase();
    const tele =
      lead.phone
        ? `<a class="lead-quick-sheet__action" href="tel:${encodeURIComponent(String(lead.phone))}">Ligar</a>`
        : '';
    const mail = lead.email
      ? `<a class="lead-quick-sheet__action" href="mailto:${escapeHtml(lead.email)}">Email</a>`
      : '';
    const quoteNew = `<a class="lead-quick-sheet__action" href="quote-builder.html?lead_id=${sid}" target="_blank" rel="noopener">Novo orcamento</a>`;
    const detailLink = `<a class="lead-quick-sheet__action" href="lead-detail.html?id=${sid}" target="_blank" rel="noopener">Pagina completa</a>`;

    const quoteRows = mergeQuoteRows(bundle.quotesPayload, bundle.proposalsPayload);
    const scheduleUrl = `lead-detail.html?id=${sid}&tab=visits&schedule=1`;

    return `
      <div class="lead-quick-sheet__toolbar lead-quick-sheet__toolbar--minimal">
        <div class="lead-quick-sheet__toolbar-row lead-quick-sheet__toolbar-row--actions">
          ${tele}${mail}${quoteNew}${detailLink}
        </div>
        <div class="lead-quick-sheet__toolbar-row lead-quick-sheet__toolbar-row--controls">
          <label class="lead-quick-sheet__inline lead-quick-sheet__inline--status">
            <span class="lead-quick-sheet__status-label-row">
              <span class="lead-quick-sheet__status-dot" id="lqsStatusDot" aria-hidden="true"></span>
              <span>Status</span>
            </span>
            <select id="lqsStatus" class="lead-quick-sheet__select lead-quick-sheet__select--status">${renderStageOptions(
              stages,
              currentSlug
            )}</select>
          </label>
          <label class="lead-quick-sheet__inline">Prioridade
            <select id="lqsPriority" class="lead-quick-sheet__select">
              <option value="low"${pri === 'low' ? ' selected' : ''}>Baixa</option>
              <option value="medium"${pri === 'medium' ? ' selected' : ''}>Media</option>
              <option value="high"${pri === 'high' ? ' selected' : ''}>Alta</option>
            </select>
          </label>
        </div>
      </div>

      <div class="lead-quick-sheet__schedule-row lead-quick-sheet__schedule-row--min">
        <a class="lead-quick-sheet__schedule-btn-min" href="${scheduleUrl}" target="_blank" rel="noopener">Agendar visita</a>
      </div>

      <section class="lead-quick-sheet__section lead-quick-sheet__section--static">
        <h3 class="lead-quick-sheet__h3 lead-quick-sheet__h3--minimal">Resumo</h3>
        ${renderPrimaryStaticSummary(lead)}
        ${renderLeadCatalogFields(lead)}
      </section>

      <section class="lead-quick-sheet__section lead-quick-sheet__section--quotes">
        <h3 class="lead-quick-sheet__h3 lead-quick-sheet__h3--minimal">Orcamentos</h3>
        <div data-lqs-quotes-list>${renderQuotesRows(quoteRows, sid)}</div>
      </section>`;
  }

  function onSheetBodyClick(e) {
    if (e.target.closest('[data-lqs-open-quotes-crm]')) {
      window.location.href = 'dashboard.html?page=quotes';
      return;
    }
    const delBtn = e.target.closest('[data-lqs-delete-quote]');
    if (delBtn && sheetLeadId) {
      const qid = delBtn.getAttribute('data-lqs-delete-quote');
      if (!qid || !confirm('Excluir este orcamento (quote)?')) return;
      void (async () => {
        try {
          const res = await fetch(
            `/api/quotes/${encodeURIComponent(qid)}?lead_id=${encodeURIComponent(String(sheetLeadId))}`,
            { method: 'DELETE', credentials: 'include', cache: 'no-store' }
          );
          let data = {};
          try {
            const t = await res.text();
            if (t && t.trim()) data = JSON.parse(t);
          } catch (_) {}
          if (!res.ok) {
            notifySheet(data.error || data.message || 'Nao foi possivel excluir.', 'error');
            return;
          }
          notifySheet('Quote excluido.', 'success');
          await refreshQuotesOnly();
        } catch (err) {
          notifySheet(err.message || 'Erro de rede', 'error');
        }
      })();
    }
  }

  function onSheetBodyChange(e) {
    const t = e.target;
    if (!sheetLeadId) return;
    if (t.id === 'lqsStatus') {
      syncStatusDotFromSelect();
      void patchLead({ status: t.value }).then(() => syncStatusDotFromSelect());
      return;
    }
    if (t.id === 'lqsPriority') {
      void patchLead({ priority: t.value });
    }
  }

  let sheetBodyDelegated = false;

  function ensureSheetDelegation() {
    if (sheetBodyDelegated) return;
    const body = document.getElementById('leadQuickSheetBody');
    if (!body) return;
    sheetBodyDelegated = true;
    body.addEventListener('click', onSheetBodyClick);
    body.addEventListener('change', onSheetBodyChange);
  }

  function resetPanelTransform(panelEl) {
    if (!panelEl) return;
    panelEl.style.transition = '';
    panelEl.style.transform = '';
    panelEl.style.opacity = '';
    panelEl.style.transformOrigin = '';
    panelEl.style.pointerEvents = '';
  }

  function animatePanelFromAnchor(anchorEl, panelEl) {
    if (!panelEl) return;
    panelEl.style.transition = 'none';

    if (!anchorEl || !(anchorEl instanceof Element)) {
      panelEl.style.opacity = '0';
      panelEl.style.transform = 'translate(-50%, -50%) scale(0.88)';
      panelEl.style.transformOrigin = 'center center';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panelEl.style.transition =
            'opacity 0.28s ease, transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)';
          panelEl.style.opacity = '1';
          panelEl.style.transform = 'translate(-50%, -50%) scale(1)';
          const done = () => resetPanelTransform(panelEl);
          panelEl.addEventListener('transitionend', done, { once: true });
          setTimeout(done, 480);
        });
      });
      return;
    }

    const card = anchorEl.getBoundingClientRect();
    const final = panelEl.getBoundingClientRect();

    const cx = card.left + card.width / 2;
    const cy = card.top + card.height / 2;
    const px = final.left + final.width / 2;
    const py = final.top + final.height / 2;

    let scale = Math.min(card.width / final.width, card.height / final.height, 1);
    scale = Math.max(scale, 0.14);

    const dx = cx - px;
    const dy = cy - py;

    panelEl.style.transformOrigin = 'center center';
    panelEl.style.transform =
      'translate(-50%, -50%) translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
    panelEl.style.opacity = '0.94';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panelEl.style.transition =
          'transform 0.42s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease';
        panelEl.style.transform = 'translate(-50%, -50%) scale(1)';
        panelEl.style.opacity = '1';
        const done = () => resetPanelTransform(panelEl);
        panelEl.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 520);
      });
    });
  }

  async function openLeadQuickSheet(id, anchorEl) {
    const sid = parseInt(id, 10);
    if (!Number.isFinite(sid)) return;
    sheetLeadId = sid;
    sheetAnchorEl = anchorEl || null;

    const root = document.getElementById('leadQuickSheet');
    const panelEl = root ? root.querySelector('.lead-quick-sheet__panel') : null;
    const body = document.getElementById('leadQuickSheetBody');
    const titleEl = document.getElementById('leadQuickSheetTitle');
    const badgesEl = document.getElementById('leadQuickSheetBadges');
    const fullLink = document.getElementById('leadQuickSheetFullLink');
    if (!root || !body || !titleEl || !badgesEl) {
      window.location.href = 'lead-detail.html?id=' + sid;
      return;
    }

    ensureSheetDelegation();

    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lead-quick-sheet-open');
    body.innerHTML = '<div class="lead-quick-sheet__loading">A carregarù</div>';
    if (fullLink) fullLink.href = 'lead-detail.html?id=' + sid;

    const [leadRes, stagesRes, quotesRes, proposalsRes] = await Promise.all([
      fetchJson('/api/leads/' + sid),
      fetchJson('/api/pipeline-stages'),
      fetchJson('/api/quotes?lead_id=' + encodeURIComponent(String(sid)) + '&limit=50'),
      fetchJson('/api/leads/' + sid + '/proposals'),
    ]);

    const ld = leadRes.data;
    if (!leadRes.ok || !ld || ld.success !== true || !ld.data) {
      body.innerHTML =
        '<p class="lead-quick-sheet__error">Nao foi possivel carregar o lead.</p>';
      requestAnimationFrame(() => {
        animatePanelFromAnchor(sheetAnchorEl, panelEl);
      });
      return;
    }

    const lead = ld.data;
    sheetLead = lead;
    titleEl.textContent = lead.name || 'Lead';

    const stages = normalizeStages(stagesRes);
    sheetStagesCache = stages;

    const bundle = {
      stages,
      quotesPayload: quotesRes.ok ? quotesRes.data : {},
      proposalsPayload: proposalsRes.ok ? proposalsRes.data : {},
    };

    body.innerHTML = renderSheetBody(lead, bundle);
    updateHeaderBadges(lead);
    syncStatusDotFromSelect();

    requestAnimationFrame(() => {
      animatePanelFromAnchor(sheetAnchorEl, panelEl);
    });
  }

  function closeLeadQuickSheet() {
    const root = document.getElementById('leadQuickSheet');
    if (!root) return;
    resetPanelTransform(root.querySelector('.lead-quick-sheet__panel'));
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lead-quick-sheet-open');
    sheetLeadId = null;
    sheetAnchorEl = null;
    sheetLead = null;
    sheetStagesCache = [];
  }

  function wire() {
    const root = document.getElementById('leadQuickSheet');
    if (!root) return;
    ensureSheetDelegation();
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
  global.animatePanelFromAnchor = animatePanelFromAnchor;
  global.closeLeadQuickSheet = closeLeadQuickSheet;

  const origViewLead = typeof global.viewLead === 'function' ? global.viewLead : null;
  global.viewLead = function (id, ev) {
    const r = document.getElementById('leadQuickSheet');
    let anchorEl = null;
    if (ev && ev.currentTarget && ev.currentTarget.closest) {
      anchorEl = ev.currentTarget.closest('.kanban-card');
    } else if (ev && ev.target && ev.target.closest) {
      anchorEl = ev.target.closest('.kanban-card');
    }
    if (r && typeof openLeadQuickSheet === 'function') {
      void openLeadQuickSheet(id, anchorEl);
    } else if (origViewLead) {
      origViewLead(id);
    } else {
      window.location.href = 'lead-detail.html?id=' + encodeURIComponent(id);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
