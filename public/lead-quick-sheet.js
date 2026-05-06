/**
 * Painel r�pido do lead no dashboard (popup centrado + anima��o FLIP a partir do cart�o Kanban).
 * Inclui resumo edit�vel, est�gio/prioridade, qualifica��o, follow-ups, intera��es, visitas e or�amentos.
 */
(function (global) {
  let sheetLeadId = null;
  let sheetAnchorEl = null;
  /** @type {Record<string, unknown> | null} */
  let sheetLead = null;

  function escapeHtml(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '�';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return escapeHtml(String(iso));
      return escapeHtml(d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    } catch {
      return escapeHtml(String(iso));
    }
  }

  function fmtMoney(n) {
    if (n == null || n === '') return '�';
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
    owner_name: 'Respons�vel',
    owner_email: 'Email do respons�vel',
    pipeline_stage_name: 'Est�gio',
    pipeline_stage_slug: 'Est�gio (slug)',
    form_type: 'Tipo de formul�rio',
    next_steps: 'Pr�ximos passos',
    next_steps_notes: 'Notas pr�ximos passos',
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

  /** Campos j� tratados no separador Resumo ou nos controlos superiores � omitir na lista extra */
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
  ]);

  function stageDisplayName(lead) {
    const slug = lead.pipeline_stage_slug || lead.status || '';
    const name = lead.pipeline_stage_name;
    if (typeof global.pipelineStageDisplayName === 'function') {
      return global.pipelineStageDisplayName(slug, name);
    }
    return name || slug || '�';
  }

  function formatFieldValue(key, val) {
    if (key === 'estimated_value') return fmtMoney(val);
    if (/_at$/.test(key) || key === 'due_date') return fmtDate(val);
    return escapeHtml(String(val));
  }

  function renderLeadCatalogFields(lead) {
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
      return '<p class="lead-quick-sheet__empty">Sem mais campos.</p>';
    }
    return `<dl class="lead-quick-sheet__dl">${rows.join('')}</dl>`;
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
    { id: 3, name: 'Reuni�o agendada', slug: 'meeting_scheduled' },
    { id: 4, name: 'Or�amento enviado', slug: 'quote_sent' },
    { id: 5, name: 'Follow-up 1', slug: 'follow_up_1' },
    { id: 6, name: 'Follow-up 2', slug: 'follow_up_2' },
    { id: 7, name: 'Tentativa de fechamento', slug: 'closing_attempt' },
    { id: 8, name: 'Ganho', slug: 'won' },
    { id: 9, name: 'Perdido', slug: 'lost' },
  ];

  function normalizeStages(stagesRes) {
    let stages = [];
    try {
      const data = stagesRes && stagesRes.data;
      if (data && data.success && Array.isArray(data.data)) {
        stages = data.data.map((s) => ({ id: s.id, name: s.name, slug: s.slug || s.name }));
      }
    } catch (_) {}
    if (!stages.length) stages = DEFAULT_STAGES.slice();
    return stages;
  }

  function renderStageOptions(stages, currentSlug) {
    return stages
      .map((stage) => {
        const slug = stage.slug;
        const label =
          typeof global.pipelineStageDisplayName === 'function'
            ? global.pipelineStageDisplayName(slug, stage.name)
            : stage.name;
        const sel = currentSlug === slug ? ' selected' : '';
        return `<option value="${escapeHtml(slug)}"${sel}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function visitStatusLabel(status) {
    const labels = {
      scheduled: 'Agendada',
      confirmed: 'Confirmada',
      completed: 'Realizada',
      cancelled: 'Cancelada',
      no_show: 'N�o compareceu',
    };
    return labels[status] || status || '';
  }

  function interactionTypeLabel(type) {
    const labels = {
      call: 'Chamada',
      whatsapp: 'WhatsApp',
      email: 'Email',
      visit: 'Visita',
      meeting: 'Reuni�o',
    };
    return labels[type] || type || '';
  }

  function renderFollowups(list) {
    if (!list || !list.length)
      return '<p class="lead-quick-sheet__empty">Sem follow-ups.</p>';
    return `<ul class="lead-quick-sheet__list" data-lqs-followups-list>${list
      .map((f) => {
        const title = escapeHtml(f.title || 'Tarefa');
        const due = f.due_date ? fmtDate(f.due_date) : '�';
        const who = f.assigned_to_name ? escapeHtml(f.assigned_to_name) : '';
        const pri = f.priority ? escapeHtml(f.priority) : '';
        const st =
          f.status === 'completed' ? 'Conclu�do' : f.status === 'cancelled' ? 'Cancelado' : 'Pendente';
        const bits = [due, st, who, pri].filter(Boolean).join(' � ');
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
        const when = v.scheduled_at ? fmtDate(v.scheduled_at) : '�';
        const st = visitStatusLabel(v.status);
        const addr = escapeHtml(buildAddressFromVisit(v));
        const asn = v.assigned_to_name ? escapeHtml(v.assigned_to_name) : '';
        const meta = [st, addr, asn].filter(Boolean).join(' � ');
        return `<li class="lead-quick-sheet__list-item"><div class="lead-quick-sheet__list-title">${when}</div><div class="lead-quick-sheet__muted">${meta || '�'}</div></li>`;
      })
      .join('')}</ul>`;
  }

  function renderInteractions(list) {
    if (!list || !list.length)
      return '<p class="lead-quick-sheet__empty">Nenhuma intera��o ainda.</p>';
    return `<ul class="lead-quick-sheet__timeline">${list
      .map((interaction) => {
        const when = interaction.created_at ? fmtDate(interaction.created_at) : '';
        const title = escapeHtml(interactionTypeLabel(interaction.type));
        const subj = interaction.subject ? `<strong>${escapeHtml(interaction.subject)}</strong><br>` : '';
        const notes = escapeHtml(interaction.notes || '');
        const by = interaction.user_name ? `<span class="lead-quick-sheet__muted">Por: ${escapeHtml(interaction.user_name)}</span>` : '';
        return `<li class="lead-quick-sheet__timeline-item">
          <div class="lead-quick-sheet__timeline-head"><span>${title}</span><span class="lead-quick-sheet__muted">${when}</span></div>
          <div class="lead-quick-sheet__timeline-body">${subj}${notes}${by ? '<br>' + by : ''}</div>
        </li>`;
      })
      .join('')}</ul>`;
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
      return `<p class="lead-quick-sheet__empty">Nenhum or�amento ligado a este lead.</p>
        <p class="lead-quick-sheet__hint">Crie um quote no CRM ou use <strong>Novo or�amento</strong> acima.</p>`;
    }
    return rows
      .map((row) => {
        const badge =
          row.kind === 'quote'
            ? '<span class="lead-quick-sheet__qbadge lead-quick-sheet__qbadge--quote">Quote</span>'
            : '<span class="lead-quick-sheet__qbadge lead-quick-sheet__qbadge--proposal">Proposta</span>';
        const when = row.created_at ? new Date(row.created_at).toLocaleDateString('pt-BR') : '�';
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

  function calculateQualificationScore() {
    const propertyType = (document.getElementById('lqsQualPropertyType')?.value || '').trim();
    const serviceType = (document.getElementById('lqsQualServiceType')?.value || '').trim();
    const area = parseFloat(document.getElementById('lqsQualArea')?.value) || 0;
    const budget = parseFloat(document.getElementById('lqsQualBudget')?.value) || 0;
    const urgency = (document.getElementById('lqsQualUrgency')?.value || 'medium').trim();

    let pts = 0;
    const propertyScores = { house: 20, apartment: 17, commercial: 12, other: 8 };
    pts += propertyScores[propertyType] || 0;
    const serviceScores = { installation: 20, renovation: 17, repair: 12, other: 8 };
    pts += serviceScores[serviceType] || 0;
    if (area > 0) {
      if (area <= 250) pts += 5;
      else if (area <= 500) pts += 10;
      else if (area <= 1000) pts += 14;
      else if (area <= 2000) pts += 18;
      else pts += 20;
    }
    if (budget > 0) {
      if (budget < 5000) pts += 5;
      else if (budget < 15000) pts += 10;
      else if (budget < 30000) pts += 15;
      else pts += 20;
    }
    const urgencyScores = { low: 8, medium: 12, high: 17, urgent: 20 };
    pts += urgencyScores[urgency] || 12;

    return Math.min(100, Math.round(pts));
  }

  function refreshQualScoreDisplay() {
    const el = document.getElementById('lqsQualScore');
    if (el) el.value = String(calculateQualificationScore());
  }

  const QUAL_LABELS = {
    property_type: { house: 'Casa', apartment: 'Apartamento', commercial: 'Comercial', other: 'Outro' },
    service_type: { installation: 'Instala��o', repair: 'Reparo', renovation: 'Renova��o', other: 'Outro' },
    urgency: { low: 'Baixa', medium: 'M�dia', high: 'Alta', urgent: 'Urgente' },
    payment_type: { cash: 'Dinheiro', financing: 'Financiamento', insurance: 'Seguro' },
  };

  function qualLabel(field, value) {
    if (!value) return '�';
    const m = QUAL_LABELS[field];
    return (m && m[value]) || value;
  }

  function renderQualificationSummary(qual) {
    let html = '<div class="lead-quick-sheet__qual-grid">';
    html += `<div><span class="lead-quick-sheet__muted">Tipo prop.</span><div>${escapeHtml(
      qualLabel('property_type', qual.property_type)
    )}</div></div>`;
    html += `<div><span class="lead-quick-sheet__muted">Servi�o</span><div>${escapeHtml(
      qualLabel('service_type', qual.service_type)
    )}</div></div>`;
    html += `<div><span class="lead-quick-sheet__muted">�rea</span><div>${qual.estimated_area != null ? escapeHtml(String(qual.estimated_area)) : '�'}</div></div>`;
    html += `<div><span class="lead-quick-sheet__muted">Or�amento</span><div>${
      qual.estimated_budget != null ? '$' + Number(qual.estimated_budget).toLocaleString() : '�'
    }</div></div>`;
    html += `<div><span class="lead-quick-sheet__muted">Urg�ncia</span><div>${escapeHtml(
      qualLabel('urgency', qual.urgency)
    )}</div></div>`;
    html += `<div><span class="lead-quick-sheet__muted">Score</span><div><strong>${qual.score != null ? escapeHtml(String(qual.score)) : '�'}</strong></div></div>`;
    html += '</div>';
    if (qual.qualification_notes) {
      html += `<p class="lead-quick-sheet__qual-notes"><span class="lead-quick-sheet__muted">Notas</span><br>${escapeHtml(
        qual.qualification_notes
      )}</p>`;
    }
    return html;
  }

  function renderQualificationForm(qual) {
    const q = qual || {};
    const sel = (name, val) => (String(q[name] || '') === String(val) ? ' selected' : '');
    return `
      <form id="lqsQualForm" class="lead-quick-sheet__form lead-quick-sheet__form--qual">
        <div class="lead-quick-sheet__form-grid">
          <label class="lead-quick-sheet__field">Tipo de propriedade *
            <select id="lqsQualPropertyType" name="property_type" required class="lqs-qual-input">
              <option value="">�</option>
              <option value="house"${sel('property_type', 'house')}>Casa</option>
              <option value="apartment"${sel('property_type', 'apartment')}>Apartamento</option>
              <option value="commercial"${sel('property_type', 'commercial')}>Comercial</option>
              <option value="other"${sel('property_type', 'other')}>Outro</option>
            </select>
          </label>
          <label class="lead-quick-sheet__field">Tipo de servi�o *
            <select id="lqsQualServiceType" name="service_type" required class="lqs-qual-input">
              <option value="">�</option>
              <option value="installation"${sel('service_type', 'installation')}>Instala��o</option>
              <option value="repair"${sel('service_type', 'repair')}>Reparo</option>
              <option value="renovation"${sel('service_type', 'renovation')}>Renova��o</option>
              <option value="other"${sel('service_type', 'other')}>Outro</option>
            </select>
          </label>
          <label class="lead-quick-sheet__field">�rea (sqft) *
            <input type="number" id="lqsQualArea" name="estimated_area" step="0.01" min="0" required class="lqs-qual-input" value="${q.estimated_area != null ? escapeHtml(String(q.estimated_area)) : ''}">
          </label>
          <label class="lead-quick-sheet__field">Or�amento estimado *
            <input type="number" id="lqsQualBudget" name="estimated_budget" step="0.01" min="0" required class="lqs-qual-input" value="${q.estimated_budget != null ? escapeHtml(String(q.estimated_budget)) : ''}">
          </label>
          <label class="lead-quick-sheet__field">Urg�ncia *
            <select id="lqsQualUrgency" name="urgency" required class="lqs-qual-input">
              <option value="low"${sel('urgency', 'low')}>Baixa</option>
              <option value="medium"${!q.urgency ? ' selected' : sel('urgency', 'medium')}>Média</option>
              <option value="high"${sel('urgency', 'high')}>Alta</option>
              <option value="urgent"${sel('urgency', 'urgent')}>Urgente</option>
            </select>
          </label>
          <label class="lead-quick-sheet__field">Score (autom�tico)
            <input type="number" id="lqsQualScore" min="0" max="100" readonly value="">
          </label>
        </div>
        <div class="lead-quick-sheet__form-grid">
          <label class="lead-quick-sheet__field">Tomador de decis�o
            <input type="text" name="decision_maker" value="${escapeHtml(q.decision_maker || '')}">
          </label>
          <label class="lead-quick-sheet__field">Prazo decis�o
            <input type="text" name="decision_timeline" value="${escapeHtml(q.decision_timeline || '')}">
          </label>
          <label class="lead-quick-sheet__field">Pagamento
            <select name="payment_type">
              <option value="">�</option>
              <option value="cash"${sel('payment_type', 'cash')}>Dinheiro</option>
              <option value="financing"${sel('payment_type', 'financing')}>Financiamento</option>
              <option value="insurance"${sel('payment_type', 'insurance')}>Seguro</option>
            </select>
          </label>
        </div>
        <p class="lead-quick-sheet__muted" style="margin:8px 0 4px;">Morada do servi�o</p>
        <div class="lead-quick-sheet__form-grid">
          <label class="lead-quick-sheet__field span-2">Rua
            <input type="text" name="address_street" value="${escapeHtml(q.address_street || '')}">
          </label>
          <label class="lead-quick-sheet__field span-2">Complemento
            <input type="text" name="address_line2" value="${escapeHtml(q.address_line2 || '')}">
          </label>
          <label class="lead-quick-sheet__field">Cidade
            <input type="text" name="address_city" value="${escapeHtml(q.address_city || '')}">
          </label>
          <label class="lead-quick-sheet__field">Estado
            <input type="text" name="address_state" value="${escapeHtml(q.address_state || '')}">
          </label>
          <label class="lead-quick-sheet__field">CEP/ZIP
            <input type="text" name="address_zip" value="${escapeHtml(q.address_zip || '')}">
          </label>
        </div>
        <label class="lead-quick-sheet__field">Notas de qualifica��o
          <textarea name="qualification_notes" rows="3">${escapeHtml(q.qualification_notes || '')}</textarea>
        </label>
        <button type="submit" class="btn btn-primary btn-sm">Guardar qualifica��o</button>
      </form>`;
  }

  function updateHeaderBadges(lead) {
    const badgesEl = document.getElementById('leadQuickSheetBadges');
    if (!badgesEl || !lead) return;
    const stageLabel = stageDisplayName(lead);
    const pri = String(lead.priority || 'medium').toLowerCase().replace(/[^a-z]/g, '') || 'medium';
    badgesEl.innerHTML =
      `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--stage">${escapeHtml(stageLabel)}</span>` +
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
        notifySheet(data.error || 'N�o foi poss�vel atualizar o lead.', 'error');
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

  async function refreshFollowupsOnly() {
    if (!sheetLeadId) return;
    const fuRes = await fetchJson('/api/leads/' + sheetLeadId + '/followups');
    const list =
      fuRes.ok && fuRes.data && fuRes.data.success && Array.isArray(fuRes.data.data) ? fuRes.data.data : [];
    const mount = document.querySelector('[data-lqs-followups-list]');
    if (mount) mount.outerHTML = renderFollowups(list);
  }

  async function refreshInteractionsOnly() {
    if (!sheetLeadId) return;
    const res = await fetchJson('/api/leads/' + sheetLeadId + '/interactions');
    const list =
      res.ok && res.data && res.data.success && Array.isArray(res.data.data) ? res.data.data : [];
    const mount = document.querySelector('[data-lqs-interactions-list]');
    if (mount) mount.innerHTML = renderInteractions(list);
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
    const quoteNew = `<a class="lead-quick-sheet__action" href="quote-builder.html?lead_id=${sid}" target="_blank" rel="noopener">Novo or�amento</a>`;
    const detailLink = `<a class="lead-quick-sheet__action" href="lead-detail.html?id=${sid}" target="_blank" rel="noopener">P�gina completa</a>`;

    const qual = bundle.qualification;
    const hasQual = qual && typeof qual === 'object' && (qual.property_type || qual.id);

    const quoteRows = mergeQuoteRows(bundle.quotesPayload, bundle.proposalsPayload);

    return `
      <div class="lead-quick-sheet__toolbar lead-quick-sheet__toolbar--rich">
        <div class="lead-quick-sheet__toolbar-row lead-quick-sheet__toolbar-row--actions">
          ${tele}${mail}${quoteNew}${detailLink}
        </div>
        <div class="lead-quick-sheet__toolbar-row lead-quick-sheet__toolbar-row--controls">
          <label class="lead-quick-sheet__inline">Est�gio
            <select id="lqsStatus" class="lead-quick-sheet__select">${renderStageOptions(stages, currentSlug)}</select>
          </label>
          <label class="lead-quick-sheet__inline">Prioridade
            <select id="lqsPriority" class="lead-quick-sheet__select">
              <option value="low"${pri === 'low' ? ' selected' : ''}>Baixa</option>
              <option value="medium"${pri === 'medium' ? ' selected' : ''}>Média</option>
              <option value="high"${pri === 'high' ? ' selected' : ''}>Alta</option>
            </select>
          </label>
        </div>
      </div>

      <div class="lead-quick-sheet__tabs" role="tablist">
        <button type="button" class="lead-quick-sheet__tab is-active" data-lqs-tab="summary" role="tab">Resumo</button>
        <button type="button" class="lead-quick-sheet__tab" data-lqs-tab="qual" role="tab">Qualifica��o</button>
        <button type="button" class="lead-quick-sheet__tab" data-lqs-tab="followups" role="tab">Follow-ups</button>
        <button type="button" class="lead-quick-sheet__tab" data-lqs-tab="interactions" role="tab">Intera��es</button>
        <button type="button" class="lead-quick-sheet__tab" data-lqs-tab="visits" role="tab">Visitas</button>
        <button type="button" class="lead-quick-sheet__tab" data-lqs-tab="quotes" role="tab">Or�amentos</button>
      </div>

      <div class="lead-quick-sheet__tab-panels">
        <div class="lead-quick-sheet__tab-panel is-active" data-lqs-panel="summary" role="tabpanel">
          <form id="lqsSummaryForm" class="lead-quick-sheet__form">
            <label class="lead-quick-sheet__field">Nome *
              <input type="text" name="name" required maxlength="255" value="${escapeHtml(lead.name || '')}">
            </label>
            <div class="lead-quick-sheet__form-grid">
              <label class="lead-quick-sheet__field">Telefone *
                <input type="text" name="phone" required maxlength="50" value="${escapeHtml(lead.phone || '')}">
              </label>
              <label class="lead-quick-sheet__field">Email *
                <input type="email" name="email" required maxlength="255" value="${escapeHtml(lead.email || '')}">
              </label>
            </div>
            <label class="lead-quick-sheet__field">Morada
              <textarea name="address" rows="2" maxlength="500">${escapeHtml(lead.address != null ? String(lead.address) : '')}</textarea>
            </label>
            <div class="lead-quick-sheet__form-grid">
              <label class="lead-quick-sheet__field">ZIP (?5 d�gitos) *
                <input type="text" name="zipcode" required maxlength="10" inputmode="numeric" value="${escapeHtml(lead.zipcode || '')}">
              </label>
              <label class="lead-quick-sheet__field">Valor estimado
                <input type="number" name="estimated_value" step="0.01" placeholder="0.00" value="${lead.estimated_value != null ? escapeHtml(String(lead.estimated_value)) : ''}">
              </label>
            </div>
            <label class="lead-quick-sheet__field">Notas
              <textarea name="notes" rows="3">${escapeHtml(lead.notes || '')}</textarea>
            </label>
            <button type="submit" class="btn btn-primary btn-sm">Guardar altera��es</button>
          </form>
          <details class="lead-quick-sheet__details">
            <summary>Mais informa��es (somente leitura)</summary>
            ${renderLeadCatalogFields(lead)}
          </details>
        </div>

        <div class="lead-quick-sheet__tab-panel" data-lqs-panel="qual" role="tabpanel">
          ${
            hasQual
              ? `<div class="lead-quick-sheet__qual-summary" id="lqsQualSummaryBlock">${renderQualificationSummary(qual)}</div>`
              : '<p class="lead-quick-sheet__hint">Preencha a qualifica��o para pontuar o lead.</p>'
          }
          ${renderQualificationForm(hasQual ? qual : null)}
        </div>

        <div class="lead-quick-sheet__tab-panel" data-lqs-panel="followups" role="tabpanel">
          <div class="lead-quick-sheet__subbar">
            <button type="button" class="btn btn-primary btn-sm" data-lqs-new-followup>Novo follow-up</button>
          </div>
          <div class="lead-quick-sheet__followups-wrap">${renderFollowups(bundle.followups)}</div>
        </div>

        <div class="lead-quick-sheet__tab-panel" data-lqs-panel="interactions" role="tabpanel">
          <form id="lqsInteractionForm" class="lead-quick-sheet__form lead-quick-sheet__form--compact">
            <div class="lead-quick-sheet__form-grid">
              <label class="lead-quick-sheet__field">Tipo *
                <select name="type" required>
                  <option value="">�</option>
                  <option value="call">Chamada</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="visit">Visita</option>
                  <option value="meeting">Reuni�o</option>
                </select>
              </label>
              <label class="lead-quick-sheet__field">Assunto
                <input type="text" name="subject" placeholder="Opcional">
              </label>
            </div>
            <label class="lead-quick-sheet__field">Notas *
              <textarea name="notes" rows="2" required placeholder="O que foi tratado�"></textarea>
            </label>
            <button type="submit" class="btn btn-secondary btn-sm">Registar intera��o</button>
          </form>
          <div data-lqs-interactions-list>${renderInteractions(bundle.interactions)}</div>
        </div>

        <div class="lead-quick-sheet__tab-panel" data-lqs-panel="visits" role="tabpanel">
          <div class="lead-quick-sheet__subbar">
            <a class="btn btn-secondary btn-sm" href="lead-detail.html?id=${sid}" target="_blank" rel="noopener">Agendar / editar na p�gina completa</a>
          </div>
          ${renderVisits(bundle.visits)}
        </div>

        <div class="lead-quick-sheet__tab-panel" data-lqs-panel="quotes" role="tabpanel">
          <div data-lqs-quotes-list>${renderQuotesRows(quoteRows, sid)}</div>
        </div>
      </div>`;
  }

  function switchSheetTab(name) {
    document.querySelectorAll('[data-lqs-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-lqs-tab') === name);
    });
    document.querySelectorAll('[data-lqs-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.getAttribute('data-lqs-panel') === name);
    });
  }

  function bindQualScoreListeners() {
    document.querySelectorAll('.lqs-qual-input').forEach((el) => {
      el.removeEventListener('input', refreshQualScoreDisplay);
      el.removeEventListener('change', refreshQualScoreDisplay);
      el.addEventListener('input', refreshQualScoreDisplay);
      el.addEventListener('change', refreshQualScoreDisplay);
    });
    refreshQualScoreDisplay();
  }

  function onSheetBodyClick(e) {
    const tabBtn = e.target.closest('[data-lqs-tab]');
    if (tabBtn) {
      const name = tabBtn.getAttribute('data-lqs-tab');
      if (name) switchSheetTab(name);
      return;
    }
    if (e.target.closest('[data-lqs-new-followup]')) {
      if (sheetLeadId && typeof global.showFollowupModal === 'function') {
        global.showFollowupModal(sheetLeadId);
      } else if (sheetLeadId) {
        notifySheet('Modal de follow-up n�o dispon�vel nesta p�gina.', 'error');
      }
      return;
    }
    if (e.target.closest('[data-lqs-open-quotes-crm]')) {
      window.location.href = 'dashboard.html?page=quotes';
      return;
    }
    const delBtn = e.target.closest('[data-lqs-delete-quote]');
    if (delBtn && sheetLeadId) {
      const qid = delBtn.getAttribute('data-lqs-delete-quote');
      if (!qid || !confirm('Excluir este or�amento (quote)?')) return;
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
            notifySheet(data.error || data.message || 'N�o foi poss�vel excluir.', 'error');
            return;
          }
          notifySheet('Quote exclu�do.', 'success');
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
      void patchLead({ status: t.value });
      return;
    }
    if (t.id === 'lqsPriority') {
      void patchLead({ priority: t.value });
    }
  }

  function onSheetBodySubmit(e) {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === 'lqsSummaryForm') {
      e.preventDefault();
      void submitSummaryForm(form);
      return;
    }
    if (form.id === 'lqsQualForm') {
      e.preventDefault();
      void submitQualForm(form);
      return;
    }
    if (form.id === 'lqsInteractionForm') {
      e.preventDefault();
      void submitInteractionForm(form);
    }
  }

  async function submitSummaryForm(form) {
    if (!sheetLeadId || !sheetLead) return;
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const phone = String(fd.get('phone') || '').trim();
    const zipRaw = String(fd.get('zipcode') || '').replace(/\D/g, '');
    const addressVal = String(fd.get('address') || '').trim();

    if (name.length < 2) {
      notifySheet('O nome deve ter pelo menos 2 caracteres.', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      notifySheet('Email inv�lido.', 'error');
      return;
    }
    if (phone.length < 3) {
      notifySheet('Telefone inv�lido.', 'error');
      return;
    }
    if (!zipRaw || zipRaw.length < 5) {
      notifySheet('ZIP deve ter pelo menos 5 d�gitos.', 'error');
      return;
    }

    const statusEl = document.getElementById('lqsStatus');
    const priorityEl = document.getElementById('lqsPriority');
    const updates = {
      name,
      email,
      phone,
      zipcode: zipRaw.slice(0, 10),
      notes: String(fd.get('notes') || ''),
      priority: priorityEl ? priorityEl.value : sheetLead.priority,
      estimated_value: fd.get('estimated_value') ? parseFloat(String(fd.get('estimated_value'))) : null,
      status: statusEl ? statusEl.value : sheetLead.status,
      address: addressVal || null,
    };

    const r = await fetch(`/api/leads/${sheetLeadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updates),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.success) {
      notifySheet(data.error || 'Erro ao guardar.', 'error');
      return;
    }
    sheetLead = data.data || sheetLead;
    updateHeaderBadges(sheetLead);
    notifySheet('Lead atualizado.', 'success');
    maybeRefreshKanban();
    const extras = document.querySelector('.lead-quick-sheet__details');
    if (extras && sheetLead) {
      const inner = extras.querySelector('.lead-quick-sheet__dl') || extras.querySelector('.lead-quick-sheet__empty');
      if (inner) {
        inner.outerHTML = renderLeadCatalogFields(sheetLead);
      }
    }
  }

  async function submitQualForm(form) {
    if (!sheetLeadId) return;
    const fd = new FormData(form);
    const propertyType = String(fd.get('property_type') || '').trim();
    const serviceType = String(fd.get('service_type') || '').trim();
    const estimatedArea = String(fd.get('estimated_area') || '').trim();
    const estimatedBudget = String(fd.get('estimated_budget') || '').trim();
    const urgency = String(fd.get('urgency') || '').trim();

    if (!propertyType || !serviceType || !estimatedArea || parseFloat(estimatedArea) <= 0) {
      notifySheet('Preencha tipo de propriedade, servi�o e �rea.', 'error');
      return;
    }
    if (!estimatedBudget || parseFloat(estimatedBudget) <= 0) {
      notifySheet('Informe o or�amento estimado.', 'error');
      return;
    }
    if (!urgency) {
      notifySheet('Selecione a urg�ncia.', 'error');
      return;
    }

    const score = calculateQualificationScore();
    const qualification = {
      property_type: propertyType,
      service_type: serviceType,
      estimated_area: parseFloat(estimatedArea) || null,
      estimated_budget: parseFloat(estimatedBudget) || null,
      urgency,
      decision_maker: String(fd.get('decision_maker') || '').trim() || null,
      decision_timeline: String(fd.get('decision_timeline') || '').trim() || null,
      payment_type: String(fd.get('payment_type') || '').trim() || null,
      score,
      qualification_notes: String(fd.get('qualification_notes') || '').trim() || null,
      address_street: String(fd.get('address_street') || '').trim() || null,
      address_line2: String(fd.get('address_line2') || '').trim() || null,
      address_city: String(fd.get('address_city') || '').trim() || null,
      address_state: String(fd.get('address_state') || '').trim() || null,
      address_zip: String(fd.get('address_zip') || '').trim() || null,
    };

    try {
      const response = await fetch(`/api/leads/${sheetLeadId}/qualification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(qualification),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        notifySheet(data.error || 'Erro ao guardar qualifica��o.', 'error');
        return;
      }
      notifySheet('Qualifica��o guardada.', 'success');
      const qres = await fetchJson('/api/leads/' + sheetLeadId + '/qualification');
      const qualData =
        qres.ok && qres.data && qres.data.success && qres.data.data ? qres.data.data : qualification;
      const sum = document.getElementById('lqsQualSummaryBlock');
      const hint = document.getElementById('lqsQualHint');
      if (sum) {
        sum.style.display = '';
        sum.innerHTML = renderQualificationSummary({ ...qualification, ...qualData });
      }
      if (hint) hint.style.display = 'none';
    } catch (err) {
      notifySheet(err.message || 'Erro de rede', 'error');
    }
  }

  async function submitInteractionForm(form) {
    if (!sheetLeadId) return;
    const fd = new FormData(form);
    const type = String(fd.get('type') || '').trim();
    const notes = String(fd.get('notes') || '').trim();
    const subject = String(fd.get('subject') || '').trim() || null;
    if (!type || !notes) {
      notifySheet('Tipo e notas s�o obrigat�rios.', 'error');
      return;
    }
    try {
      const response = await fetch(`/api/leads/${sheetLeadId}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, subject, notes }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        notifySheet(data.error || 'Erro ao criar intera��o.', 'error');
        return;
      }
      form.reset();
      await refreshInteractionsOnly();
      notifySheet('Intera��o registada.', 'success');
    } catch (err) {
      notifySheet(err.message || 'Erro de rede', 'error');
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
    body.addEventListener('submit', onSheetBodySubmit);
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
    body.innerHTML = '<div class="lead-quick-sheet__loading">A carregar�</div>';
    if (fullLink) fullLink.href = 'lead-detail.html?id=' + sid;

    const [
      leadRes,
      fuRes,
      viRes,
      stagesRes,
      qualRes,
      intRes,
      quotesRes,
      proposalsRes,
    ] = await Promise.all([
      fetchJson('/api/leads/' + sid),
      fetchJson('/api/leads/' + sid + '/followups'),
      fetchJson('/api/visits?lead_id=' + encodeURIComponent(String(sid)) + '&limit=30'),
      fetchJson('/api/pipeline-stages'),
      fetchJson('/api/leads/' + sid + '/qualification'),
      fetchJson('/api/leads/' + sid + '/interactions'),
      fetchJson('/api/quotes?lead_id=' + encodeURIComponent(String(sid)) + '&limit=50'),
      fetchJson('/api/leads/' + sid + '/proposals'),
    ]);

    const ld = leadRes.data;
    if (!leadRes.ok || !ld || ld.success !== true || !ld.data) {
      body.innerHTML =
        '<p class="lead-quick-sheet__error">N�o foi poss�vel carregar o lead.</p>';
      requestAnimationFrame(() => {
        animatePanelFromAnchor(sheetAnchorEl, panelEl);
      });
      return;
    }

    const lead = ld.data;
    sheetLead = lead;
    titleEl.textContent = lead.name || 'Lead';
    updateHeaderBadges(lead);

    const stages = normalizeStages(stagesRes);
    const followups =
      fuRes.ok && fuRes.data && fuRes.data.success && Array.isArray(fuRes.data.data)
        ? fuRes.data.data
        : [];
    const visits =
      viRes.ok && viRes.data && viRes.data.success && Array.isArray(viRes.data.data)
        ? viRes.data.data
        : [];
    const qualification =
      qualRes.ok && qualRes.data && qualRes.data.success && qualRes.data.data
        ? qualRes.data.data
        : null;
    const interactions =
      intRes.ok && intRes.data && intRes.data.success && Array.isArray(intRes.data.data)
        ? intRes.data.data
        : [];

    const bundle = {
      stages,
      followups,
      visits,
      qualification,
      interactions,
      quotesPayload: quotesRes.ok ? quotesRes.data : {},
      proposalsPayload: proposalsRes.ok ? proposalsRes.data : {},
    };

    body.innerHTML = renderSheetBody(lead, bundle);
    bindQualScoreListeners();

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
  }

  async function refreshLeadQuickSheetFollowups(leadId) {
    const lid = parseInt(leadId, 10);
    if (!Number.isFinite(lid) || lid !== sheetLeadId) return;
    await refreshFollowupsOnly();
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
  global.refreshLeadQuickSheetFollowups = refreshLeadQuickSheetFollowups;

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
