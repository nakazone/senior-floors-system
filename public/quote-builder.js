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
  let catalog = [];
  let templates = [];
  /** @type {Array<Record<string, unknown>>} */
  let erpProducts = [];
  /** @type {Array<Record<string, unknown>>} */
  let items = [];

  const money = (n) =>
    '$' +
    (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  function sumItems() {
    return items.reduce((s, it) => s + lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0), 0);
  }

  function discountAmt(sub, type, val) {
    const d = Number(val) || 0;
    if (type === 'fixed') return Math.min(Math.max(0, d), sub);
    return Math.min(sub * (d / 100), sub);
  }

  function recalc() {
    const sub = sumItems();
    const dt = $('discountType').value;
    const dv = parseFloat($('discountValue').value) || 0;
    const tax = parseFloat($('taxTotal').value) || 0;
    const disc = discountAmt(sub, dt, dv);
    const total = Math.max(0, Math.round((sub - disc + tax) * 100) / 100);
    $('dispSubtotal').textContent = money(sub);
    $('dispTotal').textContent = money(total);
    updateProfitPanel();
    return { sub, total, disc, tax };
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function updateRowAmount(tr, idx) {
    const amt = lineAmount(Number(items[idx].quantity) || 0, Number(items[idx].rate) || 0);
    const cell = tr.querySelector('[data-amt]');
    if (cell) cell.textContent = money(amt);
  }

  function bindItemInputs(tb) {
    tb.querySelectorAll('input[data-k], textarea[data-k]').forEach((el) => {
      el.addEventListener('input', function () {
        const idx = parseInt(this.getAttribute('data-i'), 10);
        const k = this.getAttribute('data-k');
        items[idx][k] =
          k === 'description' || k === 'name' ? this.value : parseFloat(this.value) || 0;
        if (k === 'rate' && items[idx].item_type === 'product') {
          const c = Number(items[idx].cost_price);
          const r = Number(items[idx].rate) || 0;
          items[idx].sell_price = r;
          if (c > 0) items[idx].markup_percentage = Math.round(((r - c) / c) * 10000) / 100;
        }
        recalc();
        const tr = this.closest('tr');
        if (tr) updateRowAmount(tr, idx);
      });
    });
    tb.querySelectorAll('select[data-k]').forEach((el) => {
      el.addEventListener('change', function () {
        const idx = parseInt(this.getAttribute('data-i'), 10);
        const k = this.getAttribute('data-k');
        if (k === 'unit_type') items[idx].unit_type = this.value;
        else if (k === 'service_type') items[idx].service_type = this.value;
      });
    });
  }

  function attachItemsTableHandlers(tb) {
    tb.onclick = (e) => {
      const cbtn = e.target.closest('[data-comment]');
      if (cbtn) {
        const idx = parseInt(cbtn.getAttribute('data-comment'), 10);
        const cur = items[idx].notes != null ? String(items[idx].notes) : '';
        const next = window.prompt('Comment for this line (shown on the PDF under the line):', cur);
        if (next === null) return;
        items[idx].notes = next.trim() || null;
        renderItems();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const idx = parseInt(del.getAttribute('data-del'), 10);
        items.splice(idx, 1);
        recalc();
        renderItems();
      }
    };
  }

  function applyProjectSqftToAllSqFtLines() {
    const input = $('quoteProjectSqft');
    if (!input) return;
    const raw = String(input.value || '').trim().replace(',', '.');
    const sq = parseFloat(raw);
    if (!Number.isFinite(sq) || sq < 0) {
      alert('Indique uma quantidade válida de sq ft (≥ 0).');
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
      alert(
        'Nenhuma linha com unidade Sq Ft. Defina a unidade «Sq Ft» nas linhas que devem usar a área do projeto.'
      );
    }
  }

  function renderItems() {
    const tb = $('itemsBody');
    tb.innerHTML = '';
    if (!items.length) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td colspan="10" class="py-10 px-4 text-center text-slate-500 text-sm leading-relaxed">' +
        'Nenhuma linha neste orçamento.<br />' +
        'Use <strong class="text-slate-700">+ Adicionar item</strong> ou escolha uma linha no <strong class="text-slate-700">catálogo</strong> abaixo.</td>';
      tb.appendChild(tr);
      recalc();
      return;
    }
    items.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100 hover:bg-slate-50/60';
      const amt = lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0);
      const hasNote = !!(it.notes && String(it.notes).trim());
      const st = it.service_type || 'Installation';
      const isProduct = it.item_type === 'product';
      const autoTag = it.estimateAuto
        ? ' <span class="text-[10px] uppercase text-amber-800 font-bold">auto</span>'
        : '';
      const kindCell = isProduct
        ? '<span class="text-xs font-semibold text-violet-700 leading-snug block">Produto</span>'
        : `<span class="text-xs font-semibold text-slate-700 leading-snug block">Serviço${autoTag}</span>`;
      const serviceCell = isProduct
        ? '<span class="text-xs text-slate-400 pt-1 inline-block">—</span>'
        : `<select data-k="service_type" data-i="${idx}" class="qb-select-compact border border-slate-300 rounded-md">
            <option value="Installation">Installation</option>
            <option value="Sand & Finishing">Sand &amp; Finishing</option>
          </select>`;
      tr.innerHTML = `
        <td class="align-top">${kindCell}</td>
        <td class="align-top"><input type="text" data-k="name" data-i="${idx}" class="qb-line-name" spellcheck="true" /></td>
        <td class="align-top"><textarea data-k="description" data-i="${idx}" class="qb-line-desc" rows="2" spellcheck="true"></textarea></td>
        <td class="align-top">${serviceCell}</td>
        <td class="align-top">
          <select data-k="unit_type" data-i="${idx}" class="qb-select-compact border border-slate-300 rounded-md">
            <option value="sq_ft">Sq Ft</option>
            <option value="linear_ft">Linear Ft</option>
            <option value="inches">Inches</option>
            <option value="fixed">Fixed</option>
            <option value="box">Box</option>
            <option value="piece">Piece</option>
          </select>
        </td>
        <td class="align-top"><input data-k="quantity" data-i="${idx}" type="number" step="0.01" class="qb-num-input border border-slate-300 rounded-md" value="${it.quantity ?? 1}" /></td>
        <td class="align-top"><input data-k="rate" data-i="${idx}" type="number" step="0.01" class="qb-num-input border border-slate-300 rounded-md" value="${it.rate ?? 0}" /></td>
        <td class="align-top text-right font-semibold text-slate-800 whitespace-nowrap pt-2" data-amt>${money(amt)}</td>
        <td class="align-top text-center pt-1">
          <button type="button" data-comment="${idx}" class="text-xs font-medium px-2 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 ${hasNote ? 'text-[#1a2036] bg-amber-50 border-amber-200' : 'text-slate-600'}">Nota</button>
        </td>
        <td class="align-top pt-1"><button type="button" data-del="${idx}" class="text-red-600 text-sm font-medium px-1 hover:bg-red-50 rounded" title="Remover linha">✕</button></td>`;
      tb.appendChild(tr);
      const nameIn = tr.querySelector('input[data-k="name"]');
      if (nameIn) nameIn.value = it.name != null ? String(it.name) : '';
      const descTa = tr.querySelector('textarea[data-k="description"]');
      if (descTa) descTa.value = it.description != null ? String(it.description) : '';
      tr.querySelector(`select[data-k="unit_type"][data-i="${idx}"]`).value = it.unit_type || 'sq_ft';
      const stSel = tr.querySelector(`select[data-k="service_type"][data-i="${idx}"]`);
      if (stSel) {
        stSel.value = st === 'Sand & Finishing' ? 'Sand & Finishing' : 'Installation';
      }
    });

    bindItemInputs(tb);
    attachItemsTableHandlers(tb);
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
    if (loadedQuoteLeadId != null && Number.isFinite(loadedQuoteLeadId)) lead_id = loadedQuoteLeadId;
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
    const cid = parseInt($('customerId').value, 10);
    if (!cid) {
      alert('Selecione um cliente.');
      return;
    }
    const body = payload();
    try {
      if (quoteId) {
        const r = await api(`/api/quotes/${quoteId}/full`, { method: 'PUT', body: JSON.stringify(body) });
        if (r.data && r.data.quote) {
          $('quoteMeta').textContent = `Quote ${r.data.quote.quote_number || '#' + r.data.quote.id} · total ${money(r.data.quote.total_amount)}`;
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
      alert('Guardado.');
      enableActions();
    } catch (e) {
      alert(e.message);
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

    try {
      const pr = await api('/api/erp/products?limit=500').catch(() => ({ data: [] }));
      erpProducts = pr.data || [];
    } catch {
      erpProducts = [];
    }

    const cs = $('customerId');
    cs.innerHTML = '<option value="">— Selecionar cliente —</option>';
    clients.forEach((c) => {
      const label =
        c.customer_type === 'builder' && c.responsible_name
          ? `${c.name} · ${c.responsible_name} (${c.email})`
          : `${c.name} (${c.email})`;
      cs.innerHTML += `<option value="${c.id}">${escapeAttr(label)}</option>`;
    });

    const cp = $('catalogPick');
    cp.innerHTML = '<option value="">— Linha do catálogo —</option>';
    catalog.forEach((row) => {
      const b = Number(row.rate_builder != null ? row.rate_builder : row.default_rate) || 0;
      const c = Number(row.rate_customer != null ? row.rate_customer : row.default_rate) || 0;
      cp.innerHTML += `<option value="${row.id}">${escapeAttr(row.name)} — B:${money(b)} / C:${money(c)} (${escapeAttr(row.unit_type || '')})</option>`;
    });

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
      setPublicLink('');
      enableActions();
      renderItems();
    }

    if (pendingLeadId != null && Number.isFinite(pendingLeadId)) {
      try {
        const lr = await fetch(`/api/leads/${pendingLeadId}`, { credentials: 'include' }).then((r) => r.json());
        const hint = $('leadContextHint');
        if (lr.success && lr.data && hint) {
          const name = lr.data.name ? String(lr.data.name) : `Lead #${pendingLeadId}`;
          hint.textContent = `Associado ao lead: ${name}. O orçamento ficará ligado a este lead ao guardar.`;
          hint.classList.remove('hidden');
        }
        const em = lr.success && lr.data && lr.data.email ? String(lr.data.email).trim().toLowerCase() : '';
        if (em) {
          const match = clients.find((c) => String(c.email || '').trim().toLowerCase() === em);
          if (match) {
            $('customerId').value = String(match.id);
            applyPricingFromCustomerId(String(match.id));
            refreshRatesForCatalogLines();
            renderItems();
          }
        }
      } catch (_) {
        /* ignore */
      }
    }

    const modal = $('addItemModal');
    const modalProductSection = $('modalProductSection');
    const modalConfirmProduct = $('modalConfirmProduct');
    const modalError = $('modalError');
    const modalHint = $('modalProductHint');
    let modalPreview = null;

    function openAddItemModal() {
      modalError.classList.add('hidden');
      modalHint.classList.add('hidden');
      modalProductSection.classList.add('hidden');
      modalConfirmProduct.classList.add('hidden');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
    function closeAddItemModal() {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    function fillProductSelect() {
      const sel = $('modalProductSelect');
      sel.innerHTML = '<option value="">— Select product —</option>';
      erpProducts.forEach((p) => {
        const lab = `${escapeAttr(p.supplier_name || '')}: ${escapeAttr(p.name)} (${escapeAttr(p.category)})`;
        sel.innerHTML += `<option value="${p.id}">${lab}</option>`;
      });
    }

    async function loadProductPreview(pid) {
      const r = await api('/api/erp/products/preview/' + pid);
      modalPreview = r.data;
      const pr = r.data.product;
      $('modalDispCost').textContent = money(pr.cost_price);
      $('modalDispDefMargin').textContent = `${r.data.default_markup_percentage}%`;
      $('modalMarkup').value = String(r.data.default_markup_percentage);
      $('modalSell').value = String(r.data.suggested_sell_price);
      modalHint.textContent = (r.data.warnings || []).join(' ') || '';
      modalHint.classList.toggle('hidden', !modalHint.textContent);
    }

    $('modalBtnService').addEventListener('click', () => {
      items.push(emptyLine());
      closeAddItemModal();
      renderItems();
    });

    $('modalBtnProduct').addEventListener('click', () => {
      modalProductSection.classList.remove('hidden');
      modalConfirmProduct.classList.remove('hidden');
      fillProductSelect();
      modalPreview = null;
      $('modalDispCost').textContent = '—';
      $('modalDispDefMargin').textContent = '—';
      $('modalMarkup').value = '';
      $('modalSell').value = '';
      $('modalQty').value = '1';
    });

    $('modalProductSelect').addEventListener('change', async () => {
      const pid = parseInt($('modalProductSelect').value, 10);
      modalError.classList.add('hidden');
      if (!pid) {
        modalPreview = null;
        return;
      }
      try {
        await loadProductPreview(pid);
      } catch (e) {
        modalError.textContent = e.message;
        modalError.classList.remove('hidden');
      }
    });

    $('modalMarkup').addEventListener('input', () => {
      if (!modalPreview) return;
      const cost = modalPreview.product.cost_price;
      const m = parseFloat($('modalMarkup').value) || 0;
      $('modalSell').value = String(sellFromCostMarkup(cost, m));
    });

    $('modalSell').addEventListener('input', () => {
      if (!modalPreview) return;
      const cost = Number(modalPreview.product.cost_price);
      const sell = parseFloat($('modalSell').value);
      if (cost > 0 && Number.isFinite(sell)) {
        const m = ((sell - cost) / cost) * 100;
        $('modalMarkup').value = String(Math.round(m * 100) / 100);
      }
    });

    $('modalConfirmProduct').addEventListener('click', () => {
      modalError.classList.add('hidden');
      const pid = parseInt($('modalProductSelect').value, 10);
      if (!pid || !modalPreview) {
        modalError.textContent = 'Select a product.';
        modalError.classList.remove('hidden');
        return;
      }
      const m = parseFloat($('modalMarkup').value);
      if (!Number.isFinite(m) || m < 0) {
        modalError.textContent = 'Margin must be ≥ 0.';
        modalError.classList.remove('hidden');
        return;
      }
      if (m < 15) {
        if (!window.confirm('Margin is below 15%. Add this line anyway?')) return;
      }
      const sell = parseFloat($('modalSell').value);
      if (!Number.isFinite(sell) || sell < 0) {
        modalError.textContent = 'Invalid sell price.';
        modalError.classList.remove('hidden');
        return;
      }
      const qty = parseFloat($('modalQty').value) || 1;
      const pr = modalPreview.product;
      items.push({
        item_type: 'product',
        product_id: pr.id,
        name: pr.name || '',
        description: '',
        unit_type: pr.unit_type || 'sq_ft',
        quantity: qty,
        rate: sell,
        cost_price: pr.cost_price,
        markup_percentage: m,
        sell_price: sell,
        service_type: null,
        notes: null,
        catalog_customer_notes: null,
        service_catalog_id: null,
        estimateAuto: false,
      });
      closeAddItemModal();
      renderItems();
    });

    $('modalCancel').addEventListener('click', closeAddItemModal);
    $('addItemModal').addEventListener('click', (e) => {
      if (e.target.id === 'addItemModal') closeAddItemModal();
    });

    $('btnAddLine').addEventListener('click', openAddItemModal);
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

    document.querySelectorAll('input[name="pricingCatalog"]').forEach((el) => {
      el.addEventListener('change', () => {
        refreshRatesForCatalogLines();
        renderItems();
      });
    });
    $('customerId').addEventListener('change', () => {
      applyPricingFromCustomerId($('customerId').value);
      refreshRatesForCatalogLines();
      renderItems();
    });

    $('catalogPick').addEventListener('change', () => {
      const idc = parseInt($('catalogPick').value, 10);
      if (!idc) return;
      const row = catalog.find((c) => Number(c.id) === idc);
      if (row) {
        const src = catalogPricingSource();
        const rate = effectiveCatalogRate(row, src);
        const catNotes = row.notes_customer != null ? String(row.notes_customer).trim() : '';
        const category = row.category || 'Installation';
        const lineSt =
          category === 'Sand & Finishing' || String(category).includes('Sand') ? 'Sand & Finishing' : 'Installation';
        items.push({
          item_type: 'service',
          name: row.name || '',
          description: row.default_description != null ? String(row.default_description).trim() : '',
          unit_type: row.unit_type || 'sq_ft',
          quantity: 1,
          rate,
          service_type: lineSt,
          notes: null,
          catalog_customer_notes: catNotes || null,
          service_catalog_id: normalizeCatalogId(row.id),
          product_id: null,
          cost_price: null,
          markup_percentage: null,
          sell_price: null,
          estimateAuto: false,
        });
        $('catalogPick').value = '';
        renderItems();
      }
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
    $('btnEmail').addEventListener('click', async () => {
      if (!quoteId) return;
      const cid = parseInt(String($('customerId') && $('customerId').value), 10);
      const cust = Number.isFinite(cid) ? clients.find((c) => Number(c.id) === cid) : null;
      const defaultTo = cust && cust.email ? String(cust.email).trim() : '';
      const to = prompt('E-mail do destinatário:', defaultTo);
      if (to == null) return;
      const addr = String(to).trim();
      if (!addr) {
        alert('Indique um e-mail válido.');
        return;
      }
      try {
        const r = await api(`/api/quotes/${quoteId}/send-email`, {
          method: 'POST',
          body: JSON.stringify({ to: addr }),
        });
        const how = r.transport === 'smtp' ? 'SMTP' : r.transport === 'resend' ? 'Resend' : 'servidor';
        alert(`E-mail enviado (${how}).`);
      } catch (e) {
        alert(e.message || 'Falha ao enviar.');
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
        alert('Template saved.');
      } catch (e) {
        alert(e.message);
      }
    });
  }

  init().catch((e) => {
    $('authMsg').textContent = e.message;
    $('authMsg').classList.remove('hidden');
  });
})();
