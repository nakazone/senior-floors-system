/* global fetch */
(function () {
  const $ = (id) => document.getElementById(id);
  let quoteId = null;
  let customers = [];
  let catalog = [];
  let templates = [];
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

  function emptyLine() {
    return {
      description: '',
      unit_type: 'sq_ft',
      quantity: 1,
      rate: 0,
      service_type: 'Installation',
      notes: null,
      catalog_customer_notes: null,
      service_catalog_id: null,
    };
  }

  function catalogPricingSource() {
    const r = document.querySelector('input[name="pricingCatalog"]:checked');
    return r && r.value === 'builder' ? 'builder' : 'customer';
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
    tb.querySelectorAll('input[data-k]').forEach((el) => {
      el.addEventListener('input', function () {
        const idx = parseInt(this.getAttribute('data-i'), 10);
        const k = this.getAttribute('data-k');
        items[idx][k] = k === 'description' ? this.value : parseFloat(this.value) || 0;
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
        if (!items.length) items = [emptyLine()];
        recalc();
        renderItems();
      }
    };
  }

  function renderItems() {
    const tb = $('itemsBody');
    tb.innerHTML = '';
    items.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100';
      const amt = lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0);
      const hasNote = !!(it.notes && String(it.notes).trim());
      const st = it.service_type || 'Installation';
      tr.innerHTML = `
        <td class="py-2 pr-2 align-top">
          <select data-k="service_type" data-i="${idx}" class="w-full border rounded px-1 py-1 text-xs">
            <option value="Installation">Installation</option>
            <option value="Sand & Finishing">Sand &amp; Finishing</option>
          </select>
        </td>
        <td class="py-2 pr-2"><input data-k="description" data-i="${idx}" type="text" class="w-full border rounded px-2 py-1 text-sm" value="${escapeAttr(it.description || '')}" /></td>
        <td class="py-2 pr-2">
          <select data-k="unit_type" data-i="${idx}" class="w-full border rounded px-1 py-1 text-xs">
            <option value="sq_ft">Sq Ft</option>
            <option value="linear_ft">Linear Ft</option>
            <option value="inches">Inches</option>
            <option value="fixed">Fixed</option>
          </select>
        </td>
        <td class="py-2 pr-2"><input data-k="quantity" data-i="${idx}" type="number" step="0.01" class="w-full border rounded px-2 py-1 text-sm" value="${it.quantity ?? 1}" /></td>
        <td class="py-2 pr-2"><input data-k="rate" data-i="${idx}" type="number" step="0.01" class="w-full border rounded px-2 py-1 text-sm" value="${it.rate ?? 0}" /></td>
        <td class="py-2 pr-2 text-right font-medium" data-amt>${money(amt)}</td>
        <td class="py-2 pr-2 text-center">
          <button type="button" data-comment="${idx}" class="text-xs font-medium px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 ${hasNote ? 'text-[#1a2036] bg-amber-50 border-amber-200' : 'text-slate-600'}">Comment</button>
        </td>
        <td class="py-2 align-top"><button type="button" data-del="${idx}" class="text-red-600 text-xs">✕</button></td>`;
      tb.appendChild(tr);
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
    $('customerId').value = q.customer_id || '';
    $('status').value = q.status || 'draft';
    $('expirationDate').value = q.expiration_date ? String(q.expiration_date).slice(0, 10) : '';
    $('notes').value = q.notes || '';
    $('terms').value = q.terms_conditions || '';
    $('discountType').value = q.discount_type || 'percentage';
    $('discountValue').value = q.discount_value ?? 0;
    $('taxTotal').value = q.tax_total ?? 0;
    items = (q.items || []).map((it) => ({
      description: it.description,
      unit_type: it.unit_type || 'sq_ft',
      quantity: it.quantity,
      rate: it.rate,
      notes: it.notes,
      service_type: it.service_type || 'Installation',
      catalog_customer_notes: it.catalog_customer_notes || null,
      service_catalog_id: normalizeCatalogId(it.service_catalog_id),
    }));
    if (!items.length) items = [emptyLine()];
    $('quoteMeta').textContent = `Quote ${q.quote_number || '#' + q.id} · total ${money(q.total_amount)}`;
    setPublicLink(q.public_token);
    enableActions();
    renderItems();
  }

  function payload() {
    const { sub, tax } = recalc();
    const dt = $('discountType').value;
    const dv = parseFloat($('discountValue').value) || 0;
    return {
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
        description: it.description,
        unit_type: it.unit_type || 'sq_ft',
        quantity: Number(it.quantity) || 0,
        rate: Number(it.rate) || 0,
        notes: it.notes || null,
        service_type: it.service_type || null,
        catalog_customer_notes: it.catalog_customer_notes || null,
        service_catalog_id: normalizeCatalogId(it.service_catalog_id),
        type: 'service',
      })),
    };
  }

  async function saveQuote() {
    const cid = parseInt($('customerId').value, 10);
    if (!cid) {
      alert('Select a client.');
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
        history.replaceState({}, '', '?id=' + quoteId);
        await loadQuote(quoteId);
      }
      alert('Saved.');
      enableActions();
    } catch (e) {
      alert(e.message);
    }
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      $('authMsg').textContent = 'Session required — log in on the CRM first.';
      $('authMsg').classList.remove('hidden');
      return;
    }

    const [custRes, catRes, tplRes] = await Promise.all([
      api('/api/customers?limit=100'),
      api('/api/quote-catalog').catch(() => ({ data: [] })),
      api('/api/quote-templates').catch(() => ({ data: [] })),
    ]);
    customers = custRes.data || [];
    catalog = catRes.data || [];
    templates = tplRes.data || [];

    const cs = $('customerId');
    cs.innerHTML = '<option value="">— Select client —</option>';
    customers.forEach((c) => {
      cs.innerHTML += `<option value="${c.id}">${escapeAttr(c.name)} (${escapeAttr(c.email)})</option>`;
    });

    const cp = $('catalogPick');
    cp.innerHTML = '<option value="">— Pick catalog line —</option>';
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
    if (qid) {
      await loadQuote(parseInt(qid, 10));
    } else {
      items = [emptyLine()];
      $('quoteMeta').textContent = 'New quote';
      setPublicLink('');
      enableActions();
      renderItems();
    }

    $('btnAddLine').addEventListener('click', () => {
      items.push(emptyLine());
      renderItems();
    });
    $('discountType').addEventListener('change', () => recalc());
    $('discountValue').addEventListener('input', () => recalc());
    $('taxTotal').addEventListener('input', () => recalc());

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
          description: row.default_description || row.name,
          unit_type: row.unit_type || 'sq_ft',
          quantity: 1,
          rate,
          service_type: lineSt,
          notes: null,
          catalog_customer_notes: catNotes || null,
          service_catalog_id: normalizeCatalogId(row.id),
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
      items = (t.items || []).map((x) => ({
        description: x.description,
        unit_type: x.unit_type || 'sq_ft',
        quantity: Number(x.quantity) || 1,
        rate: Number(x.rate) || 0,
        notes: x.notes,
        service_type: x.service_type || 'Installation',
        catalog_customer_notes: x.catalog_customer_notes || null,
        service_catalog_id: normalizeCatalogId(x.service_catalog_id),
      }));
      if (!items.length) items = [emptyLine()];
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
      const to = prompt('Send to email (client):');
      if (!to) return;
      try {
        await api(`/api/quotes/${quoteId}/send-email`, {
          method: 'POST',
          body: JSON.stringify({ to }),
        });
        alert('Email sent (if Resend is configured on the server).');
      } catch (e) {
        alert(e.message);
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

    $('btnSaveTpl').addEventListener('click', async () => {
      const name = prompt('Template name?');
      if (!name) return;
      const body = {
        name,
        items: items.map((it) => ({
          description: it.description,
          unit_type: it.unit_type,
          quantity: it.quantity,
          rate: it.rate,
          notes: it.notes,
          service_type: it.service_type,
          catalog_customer_notes: it.catalog_customer_notes,
          service_catalog_id: normalizeCatalogId(it.service_catalog_id),
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
