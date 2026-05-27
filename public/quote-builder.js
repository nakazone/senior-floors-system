/* global fetch */
(function () {
  const $ = (id) => document.getElementById(id);
  let quoteId = null;
  /** Lead vindo de `?lead_id=` (novo orçamento a partir do lead). */
  let pendingLeadId = null;
  /** `lead_id` do quote já gravado (edição). */
  let loadedQuoteLeadId = null;
  /** Lista de clientes CRM (`/api/customers` — builders e clientes finais convertidos). */
  let clients = [];
  /** Lead escolhido na pesquisa de cliente. */
  let selectedQuoteLead = null;
  let clientSearchTimer = null;
  /** Índice da linha em edição no painel inline; `-1` = nova linha; `null` = fechado. */
  let inlineEditIdx = null;
  let catalog = [];
  let templates = [];
  /** @type {Array<Record<string, unknown>>} */
  /** @type {Array<Record<string, unknown>>} */
  let items = [];

  const money = (n) =>
    '$' +
    (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function qbToast(msg, type) {
    if (window.crmToast && typeof window.crmToast.show === 'function') {
      window.crmToast.show(msg, { type: type === 'error' ? 'error' : type === 'info' ? 'info' : 'success' });
    } else {
      alert(msg);
    }
  }

  let qbNotifyTimer = null;

  function hideQuoteNotify() {
    const root = $('qbNotify');
    if (!root) return;
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    if (qbNotifyTimer) {
      clearTimeout(qbNotifyTimer);
      qbNotifyTimer = null;
    }
  }

  /**
   * Pop-up de notificação (envio de e-mail ao cliente, etc.).
   * @param {{ type?: 'success'|'error', title: string, message: string, ms?: number }} opts
   */
  function showQuoteNotify(opts) {
    const root = $('qbNotify');
    const titleEl = $('qbNotifyTitle');
    const msgEl = $('qbNotifyMsg');
    const iconEl = $('qbNotifyIcon');
    if (!root || !titleEl || !msgEl) return;
    const type = opts.type === 'error' ? 'error' : 'success';
    const ms = typeof opts.ms === 'number' ? opts.ms : type === 'error' ? 9000 : 5500;
    root.classList.remove('qb-notify--success', 'qb-notify--error', 'hidden');
    root.classList.add(type === 'error' ? 'qb-notify--error' : 'qb-notify--success');
    titleEl.textContent = opts.title || '';
    msgEl.textContent = opts.message || '';
    if (iconEl) iconEl.textContent = type === 'error' ? '⚠️' : '✉️';
    root.setAttribute('aria-hidden', 'false');
    if (qbNotifyTimer) clearTimeout(qbNotifyTimer);
    qbNotifyTimer = setTimeout(() => hideQuoteNotify(), ms);
  }

  function wireQuoteNotify() {
    const root = $('qbNotify');
    const panel = root && root.querySelector('.qb-notify__panel');
    const closeBtn = $('qbNotifyClose');
    if (!root || !panel) return;
    panel.addEventListener('click', (e) => e.stopPropagation());
    root.addEventListener('click', () => hideQuoteNotify());
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideQuoteNotify();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.classList.contains('hidden')) hideQuoteNotify();
    });
  }

  function lineAmount(q, r) {
    return Math.round(q * r * 100) / 100;
  }

  function normalizeCatalogId(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Template DB guarda nome+descrição no campo `description` (primeira linha = nome). */
  function unpackTemplateLine(x) {
    let name = x.name != null ? String(x.name).trim() : '';
    let description = x.description != null ? String(x.description).trim() : '';
    if (!name && description) {
      const ix = description.indexOf('\n');
      if (ix >= 0) {
        name = description.slice(0, ix).trim();
        description = description.slice(ix + 1).trim();
      } else {
        name = description;
        description = '';
      }
    }
    return { name, description };
  }

  function emptyLine() {
    return {
      item_type: 'service',
      name: '',
      description: '',
      unit_type: 'sq_ft',
      quantity: 1,
      rate: 0,
      service_type: 'Installation',
      notes: null,
      catalog_customer_notes: null,
      service_catalog_id: null,
      product_id: null,
      cost_price: null,
      markup_percentage: null,
      sell_price: null,
      estimateAuto: false,
    };
  }

  function isBlankLine(it) {
    if (!it || it.estimateAuto || it.item_type === 'product') return false;
    const n = String(it.name || '').trim();
    const d = String(it.description || '').trim();
    const r = Number(it.rate) || 0;
    return !n && !d && r === 0;
  }

  function qbAdjustedSqftValue() {
    const totalSqft = parseFloat(($('qbTotalSqft') && $('qbTotalSqft').value) || '0') || 0;
    const wastePercent = parseFloat(($('qbWastePct') && $('qbWastePct').value) || '0') || 0;
    return totalSqft * (1 + wastePercent / 100);
  }

  function updateQbAdjustedSqft() {
    const el = $('qbAdjustedSqft');
    if (el) el.value = qbAdjustedSqftValue().toFixed(2);
  }

  function qbResetWaste() {
    const flooringType = ($('qbFlooringType') && $('qbFlooringType').value) || '';
    const defaults = { hardwood: 10, engineered: 8, lvp: 5, laminate: 7, tile: 12 };
    const w = defaults[flooringType] || 7;
    const wp = $('qbWastePct');
    if (wp) wp.value = String(w);
    updateQbAdjustedSqft();
    applyEstimateSmartRules();
  }

  /** Regras alinhadas a `estimate-builder.js` → `applySmartRules`. */
  function applyEstimateSmartRules() {
    updateQbAdjustedSqft();
    const flooringType = ($('qbFlooringType') && $('qbFlooringType').value) || '';
    const subfloorType = ($('qbSubfloorType') && $('qbSubfloorType').value) || '';
    const levelCondition = ($('qbLevelCondition') && $('qbLevelCondition').value) || '';
    const stairsCount = parseInt(($('qbStairsCount') && $('qbStairsCount').value) || '0', 10) || 0;
    const totalSqft = parseFloat(($('qbTotalSqft') && $('qbTotalSqft').value) || '0') || 0;
    const adjustedSqft = qbAdjustedSqftValue();

    items = items.filter((it) => !it.estimateAuto);
    if (items.length === 1 && isBlankLine(items[0])) items = [];

    if (flooringType === 'hardwood' && subfloorType === 'concrete') {
      items.push({
        ...emptyLine(),
        name: 'Moisture Barrier',
        description: 'Barreira de umidade para piso de madeira em concreto',
        unit_type: 'sq_ft',
        quantity: adjustedSqft,
        rate: 0.5,
        estimateAuto: true,
      });
    }
    if (levelCondition === 'major' && totalSqft > 0) {
      items.push({
        ...emptyLine(),
        name: 'Leveling Compound',
        description: 'Massa niveladora para piso irregular',
        unit_type: 'sq_ft',
        quantity: totalSqft,
        rate: 1.25,
        estimateAuto: true,
      });
    }
    if (stairsCount > 0) {
      items.push({
        ...emptyLine(),
        name: 'Stair Installation',
        description: `Instalação de ${stairsCount} degrau(s)`,
        unit_type: 'fixed',
        quantity: stairsCount,
        rate: 150.0,
        estimateAuto: true,
      });
    }

    recalc();
    renderItems();
  }

  function wireProjectEstimateRules() {
    const onRuleField = () => {
      updateQbAdjustedSqft();
      applyEstimateSmartRules();
    };
    ['qbFlooringType', 'qbSubfloorType', 'qbLevelCondition'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('change', onRuleField);
    });
    ['qbStairsCount', 'qbTotalSqft', 'qbWastePct'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', onRuleField);
      el.addEventListener('change', onRuleField);
    });
    const btnW = $('btnQbWasteAuto');
    if (btnW) btnW.addEventListener('click', () => qbResetWaste());
    const btnA = $('btnQbApplyRules');
    if (btnA) btnA.addEventListener('click', () => applyEstimateSmartRules());
    updateQbAdjustedSqft();
  }

  function sellFromCostMarkup(cost, mPct) {
    const c = Number(cost) || 0;
    const m = Math.max(0, Number(mPct) || 0);
    return Math.round(c * (1 + m / 100) * 10000) / 10000;
  }

  function localProfitSummary() {
    let totalCost = 0;
    let totalRevenue = 0;
    for (const it of items) {
      const q = Number(it.quantity) || 0;
      const sell = Number(it.rate) || 0;
      const cost = Number(it.cost_price);
      totalRevenue += Math.round(q * sell * 100) / 100;
      if (it.item_type === 'product' && Number.isFinite(cost) && cost >= 0) {
        totalCost += Math.round(q * cost * 100) / 100;
      }
    }
    const gp = Math.round((totalRevenue - totalCost) * 100) / 100;
    const mp = totalRevenue > 0 ? Math.round((gp / totalRevenue) * 10000) / 100 : null;
    return { totalCost, totalRevenue, grossProfit: gp, marginPct: mp };
  }

  function updateProfitPanel() {
    const p = localProfitSummary();
    const elC = $('dispCost');
    if (!elC) return;
    elC.textContent = money(p.totalCost);
    $('dispRevenue').textContent = money(p.totalRevenue);
    $('dispProfit').textContent = money(p.grossProfit);
    $('dispMarginPct').textContent = p.marginPct != null ? `${p.marginPct}%` : '—';
    const bar = $('marginBarFill');
    if (bar) {
      const w = p.marginPct != null ? Math.min(100, Math.max(0, Number(p.marginPct))) : 0;
      bar.style.width = `${w}%`;
    }
  }

  function catalogPricingSource() {
    const r = document.querySelector('input[name="pricingCatalog"]:checked');
    return r && r.value === 'builder' ? 'builder' : 'customer';
  }

  function setCatalogPricingMode(mode) {
    const m = mode === 'builder' ? 'builder' : 'customer';
    const el = document.querySelector(`input[name="pricingCatalog"][value="${m}"]`);
    if (el) el.checked = true;
  }

  /** Alinha rádios Builder / Cliente final ao tipo do cliente CRM. */
  function applyPricingFromCustomerId(cidStr) {
    const cid = parseInt(String(cidStr || '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return;
    const c = clients.find((x) => Number(x.id) === cid);
    if (!c) return;
    setCatalogPricingMode(c.customer_type === 'builder' ? 'builder' : 'customer');
  }

  /** Recalcula `rate` nas linhas vindas do catálogo conforme a taxa atual (builder vs cliente). */
  function refreshRatesForCatalogLines() {
    const src = catalogPricingSource();
    for (const it of items) {
      const catId = normalizeCatalogId(it.service_catalog_id);
      if (catId == null) continue;
      const row = catalog.find((r) => Number(r.id) === catId);
      if (!row) continue;
      it.rate = effectiveCatalogRate(row, src);
    }
  }

  function effectiveCatalogRate(row, source) {
    const b = Number(row.rate_builder != null ? row.rate_builder : row.default_rate) || 0;
    const c = Number(row.rate_customer != null ? row.rate_customer : row.default_rate) || 0;
    return source === 'builder' ? b : c;
  }


  function serviceTypeFromCatalogCategory(category) {
    const catStr = String(category || '');
    if (catStr === 'Supply' || catStr.toLowerCase() === 'supply') return 'Supply';
    if (catStr === 'Sand & Finishing' || catStr.includes('Sand')) return 'Sand & Finishing';
    return 'Installation';
  }

  function filterCatalogForServiceSearch(query) {
    const q = String(query || '').trim().toLowerCase();
    const list = !q
      ? catalog.slice(0, 40)
      : catalog.filter((row) => {
          const blob = `${row.name || ''} ${row.category || ''} ${row.unit_type || ''} ${row.default_description || ''}`.toLowerCase();
          return blob.includes(q);
        });
    return list.slice(0, 40);
  }

  function updateItemsCountLabel() {
    const el = $('itemsCountLabel');
    if (!el) return;
    const n = items.length;
    el.textContent = n === 1 ? '1 adicionado' : `${n} adicionados`;
  }

  function updateClientChip() {
    const chip = $('qbClientChip');
    const search = $('customerSearch');
    if (!chip) return;
    const val = search && String(search.value || '').trim();
    if (val) {
      chip.textContent = val;
      chip.classList.remove('hidden');
    } else {
      chip.textContent = '';
      chip.classList.add('hidden');
    }
  }

  function updateInlineItemTotal() {
    const el = $('inlineItemTotal');
    if (!el) return;
    const qty = parseFloat($('modalServiceQty')?.value) || 0;
    const rate = parseFloat($('modalServiceRate')?.value) || 0;
    el.textContent = money(lineAmount(qty, rate));
  }

  function unitLabel(unit) {
    const u = String(unit || 'sq_ft');
    if (u === 'sq_ft') return 'Sq Ft';
    if (u === 'linear_ft') return 'Linear Ft';
    if (u === 'fixed') return 'Fixed';
    return u.replace(/_/g, ' ');
  }

  function sumItems() {
    return items.reduce((s, it) => s + lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0), 0);
  }

  function discountAmt(sub, type, val) {
    const d = Number(val) || 0;
    if (type === 'fixed') return Math.min(Math.max(0, d), sub);
    return Math.min(sub * (d / 100), sub);
  }

  function updatePreviewHeader() {
    const meta = $('quoteMeta');
    const metaText = meta && meta.textContent ? meta.textContent : 'Novo orçamento';
    const top = $('topbarTitle');
    const no = $('previewEstimateNo');
    const dateEl = $('previewEstimateDate');
    const titlePart = metaText.includes('·') ? metaText.split('·')[0].trim() : metaText;
    if (top) top.textContent = titlePart;
    if (no) {
      if (quoteId) {
        const m = metaText.match(/Orçamento\s+(\S+)/);
        no.textContent = m ? m[1] : `#${quoteId}`;
      } else {
        no.textContent = 'Novo';
      }
    }
    const expEl = $('expirationDate');
    const exp = expEl && expEl.value ? String(expEl.value).slice(0, 10) : '';
    const fmt = (iso) => {
      try {
        return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      } catch (_) {
        return iso;
      }
    };
    if (dateEl) {
      dateEl.textContent = exp
        ? `Expira em ${fmt(exp)}`
        : `Criado em ${fmt(new Date().toISOString().slice(0, 10))}`;
    }
  }

  function recalc() {
    const sub = sumItems();
    const dt = $('discountType').value;
    const dv = parseFloat($('discountValue').value) || 0;
    const tax = parseFloat($('taxTotal').value) || 0;
    const disc = discountAmt(sub, dt, dv);
    const total = Math.max(0, Math.round((sub - disc + tax) * 100) / 100);
    const subEl = $('dispSubtotal');
    const discEl = $('dispDiscount');
    const taxDisp = $('dispTax');
    const totalEl = $('dispTotal');
    const balEl = $('dispBalance');
    if (subEl) subEl.textContent = money(sub);
    if (discEl) discEl.textContent = money(disc);
    if (taxDisp) taxDisp.textContent = money(tax);
    if (totalEl) totalEl.textContent = money(total);
    if (balEl) balEl.textContent = money(total);
    updateProfitPanel();
    return { sub, total, disc, tax };
  }


  function escapeHtmlText(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatLeadClientLabel(lead) {
    if (!lead) return '';
    const name = lead.name ? String(lead.name).trim() : `Lead #${lead.id}`;
    const bits = [];
    if (lead.email) bits.push(String(lead.email).trim());
    if (lead.phone) bits.push(String(lead.phone).trim());
    if (lead.id != null) bits.push(`#${lead.id}`);
    return bits.length ? `${name} (${bits.join(' · ')})` : name;
  }

  function formatCustomerLabel(c) {
    if (!c) return '';
    if (c.customer_type === 'builder' && c.responsible_name) {
      return `${c.name} · ${c.responsible_name} (${c.email || ''})`;
    }
    return `${c.name} (${c.email || ''})`;
  }

  function upsertClientInCache(c) {
    if (!c || c.id == null) return;
    const id = Number(c.id);
    const idx = clients.findIndex((x) => Number(x.id) === id);
    if (idx >= 0) clients[idx] = { ...clients[idx], ...c };
    else clients.push(c);
  }

  function hideClientSearchResults() {
    const box = $('customerSearchResults');
    if (box) {
      box.classList.add('hidden');
      box.innerHTML = '';
    }
  }

  function showClientSearchResults(html) {
    const box = $('customerSearchResults');
    if (!box) return;
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  async function fetchLeadsForClientSearch(query) {
    const q = String(query || '').trim();
    const params = new URLSearchParams({ limit: '40', page: '1' });
    if (q) params.set('q', q);
    const res = await fetch(`/api/leads?${params.toString()}`, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Não foi possível pesquisar leads.');
    }
    return Array.isArray(data.data) ? data.data : [];
  }

  function renderClientSearchResults(leads) {
    if (!leads.length) {
      showClientSearchResults('<div class="qb-client-search__empty">Nenhum lead encontrado.</div>');
      return;
    }
    const html = leads
      .map((lead) => {
        const id = Number(lead.id);
        const stage = lead.pipeline_stage_name || lead.pipeline_stage_slug || lead.status || '';
        const meta = [
          lead.email ? escapeHtmlText(lead.email) : '',
          lead.phone ? escapeHtmlText(lead.phone) : '',
          stage ? escapeHtmlText(stage) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<button type="button" class="qb-client-search__item" data-lead-id="${id}" role="option">
          <span class="qb-client-search__item-name">${escapeHtmlText(lead.name || `Lead #${id}`)}</span>
          <span class="qb-client-search__item-meta">${meta || `ID ${id}`}</span>
        </button>`;
      })
      .join('');
    showClientSearchResults(html);
  }

  async function resolveCustomerForLead(leadId) {
    const lid = parseInt(String(leadId), 10);
    if (!Number.isFinite(lid) || lid <= 0) return null;

    const byLead = await fetch(`/api/customers/by-lead/${lid}`, { credentials: 'include' }).then((r) =>
      r.json()
    );
    if (byLead.success && byLead.data && byLead.data.id != null) {
      upsertClientInCache(byLead.data);
      return Number(byLead.data.id);
    }

    const created = await fetch('/api/customers/from-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lead_id: lid, customer_type: 'customer' }),
    }).then((r) => r.json());

    if (created.success && created.data && created.data.id != null) {
      const cid = Number(created.data.id);
      try {
        const cr = await api(`/api/customers/${cid}`);
        if (cr.data) upsertClientInCache(cr.data);
        else upsertClientInCache({ id: cid, customer_type: 'customer' });
      } catch (_) {
        upsertClientInCache({ id: cid, customer_type: 'customer' });
      }
      return cid;
    }
    throw new Error(created.error || 'Não foi possível criar cliente a partir do lead.');
  }

  async function selectLeadAsClient(lead) {
    if (!lead || lead.id == null) return;
    selectedQuoteLead = lead;
    pendingLeadId = Number(lead.id);
    loadedQuoteLeadId = null;
    const search = $('customerSearch');
    if (search) search.value = formatLeadClientLabel(lead);
    hideClientSearchResults();
    updateClientChip();

    const hint = $('leadContextHint');
    if (hint) {
      hint.textContent = `Associado ao lead: ${lead.name || '#' + lead.id}. O orçamento ficará ligado a este lead ao guardar.`;
      hint.classList.remove('hidden');
    }

    try {
      const cid = await resolveCustomerForLead(lead.id);
      if (cid) {
        $('customerId').value = String(cid);
        applyPricingFromCustomerId(String(cid));
        refreshRatesForCatalogLines();
        renderItems();
      }
    } catch (e) {
      $('customerId').value = '';
      qbToast(e.message || 'Lead sem email válido para criar cliente.', 'error');
    }
  }

  async function ensureCustomerForQuote() {
    let cid = parseInt(String($('customerId') && $('customerId').value), 10);
    if (Number.isFinite(cid) && cid > 0) return cid;

    const leadId =
      (selectedQuoteLead && selectedQuoteLead.id != null && Number(selectedQuoteLead.id)) ||
      (pendingLeadId != null && Number.isFinite(pendingLeadId) ? pendingLeadId : null) ||
      (loadedQuoteLeadId != null && Number.isFinite(loadedQuoteLeadId) ? loadedQuoteLeadId : null);

    if (!leadId) {
      throw new Error('Selecione um cliente (lead).');
    }
    cid = await resolveCustomerForLead(leadId);
    if (!cid) throw new Error('Selecione um cliente (lead).');
    $('customerId').value = String(cid);
    return cid;
  }

  function getClientEmailForQuote() {
    const cid = parseInt(String($('customerId') && $('customerId').value), 10);
    if (Number.isFinite(cid) && cid > 0) {
      const c = clients.find((x) => Number(x.id) === cid);
      if (c && c.email) return String(c.email).trim();
    }
    if (selectedQuoteLead && selectedQuoteLead.email) return String(selectedQuoteLead.email).trim();
    return '';
  }

  async function setClientSearchFromLoadedQuote(q) {
    const search = $('customerSearch');
    if (!search || !q) return;
    $('customerId').value = q.customer_id != null ? String(q.customer_id) : '';

    if (q.lead_id != null && q.lead_id !== '') {
      const lid = Number(q.lead_id);
      if (Number.isFinite(lid)) {
        loadedQuoteLeadId = lid;
        selectedQuoteLead = null;
        pendingLeadId = null;
        try {
          const lr = await fetch(`/api/leads/${lid}`, { credentials: 'include' }).then((r) => r.json());
          if (lr.success && lr.data) {
            selectedQuoteLead = lr.data;
            search.value = formatLeadClientLabel(lr.data);
            const hint = $('leadContextHint');
            if (hint) {
              hint.textContent = `Associado ao lead: ${lr.data.name || '#' + lid}.`;
              hint.classList.remove('hidden');
            }
            updateClientChip();
            return;
          }
        } catch (_) {
          /* ignore */
        }
      }
    }

    if (q.customer_id) {
      const c = clients.find((x) => Number(x.id) === Number(q.customer_id));
      if (c) search.value = formatCustomerLabel(c);
    }
    updateClientChip();
  }

  function scheduleClientLeadSearch() {
    const search = $('customerSearch');
    if (!search) return;
    const q = search.value.trim();
    clearTimeout(clientSearchTimer);
    clientSearchTimer = setTimeout(async () => {
      try {
        const leads = await fetchLeadsForClientSearch(q);
        renderClientSearchResults(leads);
      } catch (e) {
        showClientSearchResults(
          `<div class="qb-client-search__empty">${escapeHtmlText(e.message || 'Erro na pesquisa')}</div>`
        );
      }
    }, 220);
  }

  function wireClientLeadSearch() {
    const search = $('customerSearch');
    const box = $('customerSearchResults');
    const wrap = $('qbClientSearchWrap');
    if (!search || !box) return;

    search.addEventListener('focus', () => {
      scheduleClientLeadSearch();
    });
    search.addEventListener('input', () => {
      selectedQuoteLead = null;
      pendingLeadId = null;
      loadedQuoteLeadId = null;
      $('customerId').value = '';
      updateClientChip();
      scheduleClientLeadSearch();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideClientSearchResults();
    });

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lead-id]');
      if (!btn) return;
      const lid = parseInt(btn.getAttribute('data-lead-id'), 10);
      if (!Number.isFinite(lid)) return;
      fetch(`/api/leads/${lid}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.data) void selectLeadAsClient(data.data);
        })
        .catch(() => qbToast('Erro ao carregar lead.', 'error'));
    });

    document.addEventListener('click', (e) => {
      if (!wrap || wrap.contains(e.target)) return;
      hideClientSearchResults();
    });
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function attachItemsListHandlers() {
    const list = $('itemsList');
    if (!list || list.dataset.bound) return;
    list.dataset.bound = '1';
    list.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const idx = parseInt(editBtn.getAttribute('data-edit'), 10);
        if (Number.isFinite(idx)) openAddItemPanel(idx);
        return;
      }
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        const idx = parseInt(delBtn.getAttribute('data-del'), 10);
        if (!Number.isFinite(idx)) return;
        if (inlineEditIdx === idx) closeAddItemPanel();
        else if (inlineEditIdx != null && inlineEditIdx > idx) inlineEditIdx -= 1;
        items.splice(idx, 1);
        recalc();
        renderItems();
      }
    });
  }

  let modalSelectedCatalogRow = null;
  let modalServiceSearchTimer = null;

  function hideModalServiceResults() {
    const box = $('modalServiceResults');
    if (box) {
      box.classList.add('hidden');
      box.innerHTML = '';
    }
  }

  function showModalServiceResults(html) {
    const box = $('modalServiceResults');
    if (!box) return;
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function renderModalServiceResults(rows) {
    if (!rows.length) {
      showModalServiceResults('<div class="qb-client-search__empty">Nenhum serviço no catálogo.</div>');
      return;
    }
    const src = catalogPricingSource();
    const html = rows
      .map((row) => {
        const id = Number(row.id);
        const rate = effectiveCatalogRate(row, src);
        const meta = [
          row.category ? escapeHtmlText(row.category) : '',
          row.unit_type ? escapeHtmlText(row.unit_type) : '',
          money(rate),
        ]
          .filter(Boolean)
          .join(' · ');
        return `<button type="button" class="qb-client-search__item" data-catalog-id="${id}" role="option">
          <span class="qb-client-search__item-name">${escapeHtmlText(row.name || `Serviço #${id}`)}</span>
          <span class="qb-client-search__item-meta">${meta}</span>
        </button>`;
      })
      .join('');
    showModalServiceResults(html);
  }

  function applyCatalogRowToServiceModal(row) {
    if (!row) return;
    modalSelectedCatalogRow = row;
    const src = catalogPricingSource();
    const rate = effectiveCatalogRate(row, src);
    $('modalServiceName').value = row.name || '';
    $('modalServiceDesc').value =
      row.default_description != null ? String(row.default_description).trim() : '';
    $('modalServiceType').value = serviceTypeFromCatalogCategory(row.category);
    $('modalServiceUnit').value = row.unit_type || 'sq_ft';
    $('modalServiceRate').value = String(rate);
    hideModalServiceResults();
    updateInlineItemTotal();
  }

  function resetServiceModalForm() {
    modalSelectedCatalogRow = null;
    const nameEl = $('modalServiceName');
    if (nameEl) nameEl.value = '';
    if ($('modalServiceDesc')) $('modalServiceDesc').value = '';
    if ($('modalServiceType')) $('modalServiceType').value = 'Installation';
    if ($('modalServiceUnit')) $('modalServiceUnit').value = 'sq_ft';
    if ($('modalServiceQty')) $('modalServiceQty').value = '1';
    if ($('modalServiceRate')) $('modalServiceRate').value = '0';
    if ($('inlineItemNote')) $('inlineItemNote').value = '';
    hideModalServiceResults();
    updateInlineItemTotal();
  }

  function fillInlineFormFromItem(it) {
    if (!it) return;
    const cid = normalizeCatalogId(it.service_catalog_id);
    modalSelectedCatalogRow = cid ? catalog.find((c) => Number(c.id) === cid) || null : null;
    $('modalServiceName').value = it.name != null ? String(it.name) : '';
    $('modalServiceDesc').value = it.description != null ? String(it.description) : '';
    $('modalServiceType').value = it.service_type || 'Installation';
    $('modalServiceUnit').value = it.unit_type || 'sq_ft';
    $('modalServiceQty').value = String(it.quantity ?? 1);
    $('modalServiceRate').value = String(it.rate ?? 0);
    if ($('inlineItemNote')) $('inlineItemNote').value = it.notes != null ? String(it.notes) : '';
    updateInlineItemTotal();
  }

  function scheduleModalServiceSearch() {
    const q = ($('modalServiceName') && $('modalServiceName').value) || '';
    clearTimeout(modalServiceSearchTimer);
    modalServiceSearchTimer = setTimeout(() => {
      renderModalServiceResults(filterCatalogForServiceSearch(q));
    }, 180);
  }

  function openAddItemPanel(idx) {
    const panel = $('addItemPanel');
    const modalError = $('modalError');
    if (!panel) return;
    inlineEditIdx = Number.isFinite(idx) ? idx : -1;
    if (modalError) modalError.classList.add('hidden');
    if (inlineEditIdx >= 0 && items[inlineEditIdx]) {
      fillInlineFormFromItem(items[inlineEditIdx]);
    } else {
      inlineEditIdx = -1;
      resetServiceModalForm();
    }
    panel.classList.remove('hidden');
    const btnAdd = $('btnAddLine');
    if (btnAdd) btnAdd.classList.add('hidden');
    const confirmBtn = $('modalConfirmService');
    if (confirmBtn) confirmBtn.textContent = inlineEditIdx >= 0 ? 'Guardar' : 'Adicionar';
    scheduleModalServiceSearch();
    const nameEl = $('modalServiceName');
    if (nameEl) {
      nameEl.focus();
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function closeAddItemPanel() {
    const panel = $('addItemPanel');
    if (panel) panel.classList.add('hidden');
    inlineEditIdx = null;
    const btnAdd = $('btnAddLine');
    if (btnAdd) btnAdd.classList.remove('hidden');
    hideModalServiceResults();
    const modalError = $('modalError');
    if (modalError) modalError.classList.add('hidden');
  }

  function confirmAddServiceLine() {
    const modalError = $('modalError');
    if (modalError) modalError.classList.add('hidden');
    const name = String(($('modalServiceName') && $('modalServiceName').value) || '').trim();
    if (!name) {
      if (modalError) {
        modalError.textContent = 'Indique o nome do serviço.';
        modalError.classList.remove('hidden');
      }
      return;
    }
    const qty = parseFloat($('modalServiceQty').value) || 1;
    const rate = parseFloat($('modalServiceRate').value) || 0;
    const row = modalSelectedCatalogRow;
    const catNotes = row && row.notes_customer != null ? String(row.notes_customer).trim() : '';
    const noteVal = $('inlineItemNote') ? String($('inlineItemNote').value || '').trim() : '';
    const existing = inlineEditIdx >= 0 ? items[inlineEditIdx] : null;
    const line = {
      item_type: existing && existing.item_type === 'product' ? 'product' : 'service',
      name,
      description: String(($('modalServiceDesc') && $('modalServiceDesc').value) || '').trim(),
      unit_type: $('modalServiceUnit').value || 'sq_ft',
      quantity: qty,
      rate,
      service_type: $('modalServiceType').value || 'Installation',
      notes: noteVal || null,
      catalog_customer_notes:
        catNotes || (existing && existing.catalog_customer_notes) || null,
      service_catalog_id: row
        ? normalizeCatalogId(row.id)
        : existing
          ? normalizeCatalogId(existing.service_catalog_id)
          : null,
      product_id: existing && existing.product_id != null ? existing.product_id : null,
      cost_price: existing && existing.cost_price != null ? existing.cost_price : null,
      markup_percentage:
        existing && existing.markup_percentage != null ? existing.markup_percentage : null,
      sell_price: existing && existing.sell_price != null ? existing.sell_price : null,
      estimateAuto: existing ? !!existing.estimateAuto : false,
    };
    if (inlineEditIdx >= 0) items[inlineEditIdx] = line;
    else items.push(line);
    closeAddItemPanel();
    renderItems();
  }

  function applyProjectSqftToAllSqFtLines() {
    const input = $('quoteProjectSqft');
    if (!input) return;
    const raw = String(input.value || '').trim().replace(',', '.');
    const sq = parseFloat(raw);
    if (!Number.isFinite(sq) || sq < 0) {
      qbToast('Indique uma quantidade válida de sq ft (≥ 0).', 'error');
      return;
    }
    let n = 0;
    for (const it of items) {
      if (String(it.unit_type || 'sq_ft') === 'sq_ft') {
        it.quantity = sq;
        n += 1;
      }
    }
    recalc();
    renderItems();
    if (n === 0) {
      qbToast(
        'Nenhuma linha com unidade Sq Ft. Defina a unidade «Sq Ft» nas linhas que devem usar a área do projeto.',
        'info'
      );
    }
  }

  function renderItems() {
    const list = $('itemsList');
    if (!list) return;
    list.innerHTML = '';
    updateItemsCountLabel();

    items.forEach((it, idx) => {
      if (inlineEditIdx === idx) return;
      const amt = lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0);
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.rate) || 0;
      const name = it.name != null ? String(it.name).trim() : '';
      const desc = it.description != null ? String(it.description).trim() : '';
      const isProduct = it.item_type === 'product';
      const badges = [];
      if (it.estimateAuto) badges.push('<span class="qb-item-card__badge qb-item-card__badge--auto">auto</span>');
      if (isProduct) badges.push('<span class="qb-item-card__badge qb-item-card__badge--product">produto</span>');

      const card = document.createElement('article');
      card.className = 'qb-item-card';
      card.setAttribute('role', 'listitem');
      card.innerHTML = `
        <div class="qb-item-card__grip" aria-hidden="true">⋮⋮</div>
        <div class="qb-item-card__body">
          <div class="qb-item-card__top">
            <span class="qb-item-card__name">${escapeHtmlText(name || 'Sem nome')}${badges.join('')}</span>
            <span class="qb-item-card__total">${money(amt)}</span>
          </div>
          ${desc ? `<p class="qb-item-card__desc">— ${escapeHtmlText(desc)}</p>` : ''}
          <p class="qb-item-card__meta">${qty} × ${money(rate)} <span class="text-slate-400">(${escapeHtmlText(unitLabel(it.unit_type))})</span></p>
        </div>
        <div class="qb-item-card__actions">
          <button type="button" class="qb-item-card__btn" data-edit="${idx}">Editar</button>
          <button type="button" class="qb-item-card__btn qb-item-card__btn--danger" data-del="${idx}" title="Remover">Remover</button>
        </div>`;
      list.appendChild(card);
    });

    recalc();
  }

  async function api(path, opt) {
    const r = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...opt,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || r.statusText);
    return j;
  }

  function setPublicLink(token) {
    const w = $('publicLinkWrap');
    const a = $('publicLink');
    if (!token) {
      w.classList.add('hidden');
      return;
    }
    a.href = `${location.origin}/quote-public.html?t=${encodeURIComponent(token)}`;
    a.textContent = a.href;
    w.classList.remove('hidden');
  }

  function enableActions() {
    $('btnPdf').disabled = !quoteId;
    $('btnEmail').disabled = !quoteId;
    $('btnDup').disabled = !quoteId;
  }

  async function loadQuote(id) {
    const r = await api(`/api/quotes/${id}`);
    const q = r.data;
    if (!q) return;
    quoteId = q.id;
    loadedQuoteLeadId = q.lead_id != null && q.lead_id !== '' ? Number(q.lead_id) : null;
    if (!Number.isFinite(loadedQuoteLeadId)) loadedQuoteLeadId = null;
    $('customerId').value = q.customer_id || '';
    await setClientSearchFromLoadedQuote(q);
    $('status').value = q.status || 'draft';
    $('expirationDate').value = q.expiration_date ? String(q.expiration_date).slice(0, 10) : '';
    $('notes').value = q.notes || '';
    $('terms').value = q.terms_conditions || '';
    $('discountType').value = q.discount_type || 'percentage';
    $('discountValue').value = q.discount_value ?? 0;
    $('taxTotal').value = q.tax_total ?? 0;
    items = (q.items || []).map((it) => ({
      item_type: it.item_type || 'service',
      name: it.name != null ? String(it.name) : '',
      description: it.description != null ? String(it.description) : '',
      unit_type: it.unit_type || 'sq_ft',
      quantity: it.quantity,
      rate: it.rate,
      notes: it.notes,
      service_type: it.item_type === 'product' ? null : it.service_type || 'Installation',
      catalog_customer_notes: it.catalog_customer_notes || null,
      service_catalog_id: normalizeCatalogId(it.service_catalog_id),
      product_id: it.product_id != null ? Number(it.product_id) : null,
      cost_price: it.cost_price != null ? Number(it.cost_price) : null,
      markup_percentage: it.markup_percentage != null ? Number(it.markup_percentage) : null,
      sell_price: it.sell_price != null ? Number(it.sell_price) : null,
      estimateAuto: false,
    }));
    $('quoteMeta').textContent = `Orçamento ${q.quote_number || '#' + q.id} · total ${money(q.total_amount)}`;
    updatePreviewHeader();
    setPublicLink(q.public_token);
    enableActions();
    applyPricingFromCustomerId($('customerId').value);
    renderItems();
  }

  function payload() {
    const { sub, tax } = recalc();
    const dt = $('discountType').value;
    const dv = parseFloat($('discountValue').value) || 0;
    let lead_id = null;
    if (selectedQuoteLead && selectedQuoteLead.id != null) lead_id = Number(selectedQuoteLead.id);
    else if (loadedQuoteLeadId != null && Number.isFinite(loadedQuoteLeadId)) lead_id = loadedQuoteLeadId;
    else if (pendingLeadId != null && Number.isFinite(pendingLeadId)) lead_id = pendingLeadId;
    const base = {
      customer_id: parseInt($('customerId').value, 10) || null,
      status: $('status').value,
      expiration_date: $('expirationDate').value || null,
      notes: $('notes').value || null,
      terms_conditions: $('terms').value || null,
      discount_type: dt,
      discount_value: dv,
      tax_total: tax,
      subtotal: sub,
      items: items.map((it) => ({
        item_type: it.item_type || 'service',
        name: it.name != null && String(it.name).trim() ? String(it.name).trim() : null,
        description: it.description != null && String(it.description).trim() ? String(it.description).trim() : null,
        unit_type: it.unit_type || 'sq_ft',
        quantity: Number(it.quantity) || 0,
        rate: Number(it.rate) || 0,
        notes: it.notes || null,
        service_type: it.item_type === 'product' ? null : it.service_type || null,
        catalog_customer_notes: it.catalog_customer_notes || null,
        service_catalog_id: normalizeCatalogId(it.service_catalog_id),
        product_id: it.product_id != null ? Number(it.product_id) : null,
        cost_price: it.cost_price != null ? Number(it.cost_price) : null,
        markup_percentage: it.markup_percentage != null ? Number(it.markup_percentage) : null,
        sell_price: it.sell_price != null ? Number(it.sell_price) : Number(it.rate) || null,
      })),
    };
    if (lead_id != null) base.lead_id = lead_id;
    return base;
  }

  async function saveQuote() {
    let cid;
    try {
      cid = await ensureCustomerForQuote();
    } catch (e) {
      qbToast(e.message || 'Selecione um cliente (lead).', 'error');
      return;
    }
    const body = payload();
    try {
      if (quoteId) {
        const r = await api(`/api/quotes/${quoteId}/full`, { method: 'PUT', body: JSON.stringify(body) });
        if (r.data && r.data.quote) {
          $('quoteMeta').textContent = `Orçamento ${r.data.quote.quote_number || '#' + r.data.quote.id} · total ${money(r.data.quote.total_amount)}`;
          updatePreviewHeader();
          setPublicLink(r.data.quote.public_token);
        }
      } else {
        const r = await api('/api/quotes/full', { method: 'POST', body: JSON.stringify(body) });
        quoteId = r.data.quote.id;
        const lid = pendingLeadId != null && Number.isFinite(pendingLeadId) ? pendingLeadId : null;
        history.replaceState(
          {},
          '',
          lid ? `?id=${quoteId}&lead_id=${lid}` : `?id=${quoteId}`
        );
        await loadQuote(quoteId);
      }
      qbToast('Guardado.', 'success');
      enableActions();
    } catch (e) {
      qbToast(e.message || 'Erro ao guardar', 'error');
    }
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      $('authMsg').textContent = 'É necessária sessão — inicie sessão no CRM primeiro.';
      $('authMsg').classList.remove('hidden');
      return;
    }

    const [custRes, catRes, tplRes] = await Promise.all([
      api('/api/customers?limit=100'),
      api('/api/quote-catalog').catch(() => ({ data: [] })),
      api('/api/quote-templates').catch(() => ({ data: [] })),
    ]);
    clients = custRes.data || [];
    catalog = catRes.data || [];
    templates = tplRes.data || [];

    wireClientLeadSearch();
    attachItemsListHandlers();

    const ts = $('templateSelect');
    ts.innerHTML = '<option value="">— Template —</option>';
    templates.forEach((t) => {
      ts.innerHTML += `<option value="${t.id}">${escapeAttr(t.name)}</option>`;
    });

    const params = new URLSearchParams(location.search);
    const qid = params.get('id');
    const leadParam = params.get('lead_id');
    if (leadParam && !qid) {
      const n = parseInt(leadParam, 10);
      if (Number.isFinite(n)) pendingLeadId = n;
    }
    if (qid) {
      await loadQuote(parseInt(qid, 10));
    } else {
      items = [];
      loadedQuoteLeadId = null;
      $('quoteMeta').textContent = 'Novo orçamento';
      updatePreviewHeader();
      setPublicLink('');
      enableActions();
      renderItems();
    }

    if (pendingLeadId != null && Number.isFinite(pendingLeadId)) {
      try {
        const lr = await fetch(`/api/leads/${pendingLeadId}`, { credentials: 'include' }).then((r) => r.json());
        if (lr.success && lr.data) await selectLeadAsClient(lr.data);
      } catch (_) {
        /* ignore */
      }
    }

    const addItemPanel = $('addItemPanel');
    const modalServiceName = $('modalServiceName');
    const modalServiceResults = $('modalServiceResults');
    const modalServiceWrap = $('modalServiceSearchWrap');

    if (modalServiceName) {
      modalServiceName.addEventListener('focus', scheduleModalServiceSearch);
      modalServiceName.addEventListener('input', () => {
        modalSelectedCatalogRow = null;
        scheduleModalServiceSearch();
      });
      modalServiceName.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideModalServiceResults();
      });
    }
    ['modalServiceQty', 'modalServiceRate'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('input', updateInlineItemTotal);
    });

    if (modalServiceResults) {
      modalServiceResults.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-catalog-id]');
        if (!btn) return;
        const cid = parseInt(btn.getAttribute('data-catalog-id'), 10);
        const row = catalog.find((c) => Number(c.id) === cid);
        if (row) applyCatalogRowToServiceModal(row);
      });
    }

    document.addEventListener('click', (e) => {
      if (!addItemPanel || addItemPanel.classList.contains('hidden')) return;
      if (!modalServiceWrap || modalServiceWrap.contains(e.target)) return;
      hideModalServiceResults();
    });

    $('modalConfirmService').addEventListener('click', confirmAddServiceLine);
    $('modalCancel').addEventListener('click', closeAddItemPanel);
    $('btnAddLine').addEventListener('click', () => openAddItemPanel(-1));
    const btnSqft = $('btnApplySqftToLines');
    if (btnSqft) btnSqft.addEventListener('click', () => applyProjectSqftToAllSqFtLines());
    const sqftIn = $('quoteProjectSqft');
    if (sqftIn) {
      sqftIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyProjectSqftToAllSqFtLines();
        }
      });
    }
    $('discountType').addEventListener('change', () => recalc());
    $('discountValue').addEventListener('input', () => recalc());
    $('taxTotal').addEventListener('input', () => recalc());
    const expIn = $('expirationDate');
    if (expIn) expIn.addEventListener('change', updatePreviewHeader);

    document.querySelectorAll('input[name="pricingCatalog"]').forEach((el) => {
      el.addEventListener('change', () => {
        refreshRatesForCatalogLines();
        renderItems();
      });
    });
    $('btnApplyTemplate').addEventListener('click', async () => {
      const tid = parseInt($('templateSelect').value, 10);
      if (!tid) return;
      const r = await api(`/api/quote-templates/${tid}`);
      const t = r.data;
      items = (t.items || []).map((x) => {
        const { name: tplName, description: tplDesc } = unpackTemplateLine(x);
        return {
          item_type: x.item_type || 'service',
          name: tplName,
          description: tplDesc,
          unit_type: x.unit_type || 'sq_ft',
          quantity: Number(x.quantity) || 1,
          rate: Number(x.rate) || 0,
          notes: x.notes,
          service_type: x.item_type === 'product' ? null : x.service_type || 'Installation',
          catalog_customer_notes: x.catalog_customer_notes || null,
          service_catalog_id: normalizeCatalogId(x.service_catalog_id),
          product_id: x.product_id != null ? Number(x.product_id) : null,
          cost_price: x.cost_price != null ? Number(x.cost_price) : null,
          markup_percentage: x.markup_percentage != null ? Number(x.markup_percentage) : null,
          sell_price: x.sell_price != null ? Number(x.sell_price) : null,
          estimateAuto: false,
        };
      });
      renderItems();
    });

    $('btnSave').addEventListener('click', saveQuote);
    $('btnPdf').addEventListener('click', async () => {
      if (!quoteId) return;
      await api(`/api/quotes/${quoteId}/generate-pdf`, { method: 'POST', body: '{}' });
      window.open(`/api/quotes/${quoteId}/invoice-pdf`, '_blank');
    });
    wireQuoteNotify();

    $('btnEmail').addEventListener('click', async () => {
      if (!quoteId) return;
      let cid;
      try {
        cid = await ensureCustomerForQuote();
      } catch (e) {
        showQuoteNotify({
          type: 'error',
          title: 'Cliente necessário',
          message: e.message || 'Selecione um lead na pesquisa de cliente.',
          ms: 8000,
        });
        return;
      }
      const preview = getClientEmailForQuote();
      if (!preview) {
        showQuoteNotify({
          type: 'error',
          title: 'E-mail em falta',
          message: 'Este cliente não tem e-mail no cadastro. Edite o cliente no CRM e adicione o e-mail antes de enviar.',
          ms: 10000,
        });
        return;
      }
      try {
        const r = await api(`/api/quotes/${quoteId}/send-email`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const how = r.transport === 'smtp' ? 'SMTP' : r.transport === 'resend' ? 'Resend' : 'servidor';
        showQuoteNotify({
          type: 'success',
          title: 'E-mail enviado',
          message: `O orçamento foi enviado para ${preview} (${how}).`,
        });
      } catch (e) {
        showQuoteNotify({
          type: 'error',
          title: 'Falha ao enviar',
          message: e.message || 'Não foi possível enviar o e-mail. Tente novamente ou verifique a configuração do servidor.',
          ms: 12000,
        });
      }
    });
    $('btnDup').addEventListener('click', async () => {
      if (!quoteId) return;
      const r = await api(`/api/quotes/${quoteId}/duplicate`, { method: 'POST', body: '{}' });
      const d = r.data;
      if (d && d.quote) {
        location.href = 'quote-builder.html?id=' + d.quote.id;
      }
    });

    wireProjectEstimateRules();

    $('btnSaveTpl').addEventListener('click', async () => {
      const name = prompt('Template name?');
      if (!name) return;
      const body = {
        name,
        items: items.map((it) => ({
          item_type: it.item_type || 'service',
          name: it.name != null && String(it.name).trim() ? String(it.name).trim() : null,
          description: it.description != null && String(it.description).trim() ? String(it.description).trim() : null,
          unit_type: it.unit_type,
          quantity: it.quantity,
          rate: it.rate,
          notes: it.notes,
          service_type: it.service_type,
          catalog_customer_notes: it.catalog_customer_notes,
          service_catalog_id: normalizeCatalogId(it.service_catalog_id),
          product_id: it.product_id,
          cost_price: it.cost_price,
          markup_percentage: it.markup_percentage,
          sell_price: it.sell_price,
        })),
      };
      try {
        await api('/api/quote-templates', { method: 'POST', body: JSON.stringify(body) });
        qbToast('Template guardado.', 'success');
      } catch (e) {
        qbToast(e.message || 'Erro ao guardar template', 'error');
      }
    });
  }

  init().catch((e) => {
    $('authMsg').textContent = e.message;
    $('authMsg').classList.remove('hidden');
  });
})();
