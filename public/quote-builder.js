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

  function renderItems() {
    const tb = $('itemsBody');
    tb.innerHTML = '';
    items.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100';
      const amt = lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0);
      tr.innerHTML = `
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
        <td class="py-2 pr-2 text-right font-medium">${money(amt)}</td>
        <td class="py-2"><button type="button" data-del="${idx}" class="text-red-600 text-xs">✕</button></td>`;
      tb.appendChild(tr);
      tr.querySelector(`select[data-k="unit_type"][data-i="${idx}"]`).value = it.unit_type || 'sq_ft';
    });

    tb.querySelectorAll('input[data-k]').forEach((el) => {
      el.addEventListener('input', () => {
        const idx = parseInt(el.getAttribute('data-i'), 10);
        const k = el.getAttribute('data-k');
        items[idx][k] = k === 'description' ? el.value : parseFloat(el.value) || 0;
        recalc();
        renderItems();
      });
    });
    tb.querySelectorAll('select[data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        const idx = parseInt(el.getAttribute('data-i'), 10);
        items[idx].unit_type = el.value;
      });
    });
    tb.querySelectorAll('button[data-del]').forEach((b) => {
      b.addEventListener('click', () => {
        items.splice(parseInt(b.getAttribute('data-del'), 10), 1);
        if (!items.length) items = [{ description: '', unit_type: 'sq_ft', quantity: 1, rate: 0 }];
        recalc();
        renderItems();
      });
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
    $('customerId').value = q.customer_id || '';
    $('serviceType').value = q.service_type || 'Installation';
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
      service_catalog_id: it.service_catalog_id,
    }));
    if (!items.length) items = [{ description: '', unit_type: 'sq_ft', quantity: 1, rate: 0 }];
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
      service_type: $('serviceType').value,
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
        service_catalog_id: it.service_catalog_id || null,
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
      cp.innerHTML += `<option value="${row.id}">${escapeAttr(row.name)} — $${row.default_rate}/${row.unit_type}</option>`;
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
      items = [{ description: '', unit_type: 'sq_ft', quantity: 1, rate: 0 }];
      $('quoteMeta').textContent = 'New quote';
      setPublicLink('');
      enableActions();
      renderItems();
    }

    $('btnAddLine').addEventListener('click', () => {
      items.push({ description: '', unit_type: 'sq_ft', quantity: 1, rate: 0 });
      renderItems();
    });
    $('discountType').addEventListener('change', () => recalc());
    $('discountValue').addEventListener('input', () => recalc());
    $('taxTotal').addEventListener('input', () => recalc());

    $('catalogPick').addEventListener('change', () => {
      const idc = parseInt($('catalogPick').value, 10);
      if (!idc) return;
      const row = catalog.find((c) => c.id === idc);
      if (row) {
        items.push({
          description: row.default_description || row.name,
          unit_type: row.unit_type || 'sq_ft',
          quantity: 1,
          rate: Number(row.default_rate) || 0,
          service_catalog_id: row.id,
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
      if (t.service_type) $('serviceType').value = t.service_type;
      items = (t.items || []).map((x) => ({
        description: x.description,
        unit_type: x.unit_type || 'sq_ft',
        quantity: Number(x.quantity) || 1,
        rate: Number(x.rate) || 0,
        notes: x.notes,
        service_catalog_id: x.service_catalog_id,
      }));
      if (!items.length) items = [{ description: '', unit_type: 'sq_ft', quantity: 1, rate: 0 }];
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
        service_type: $('serviceType').value,
        items: items.map((it) => ({
          description: it.description,
          unit_type: it.unit_type,
          quantity: it.quantity,
          rate: it.rate,
          notes: it.notes,
          service_catalog_id: it.service_catalog_id,
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
