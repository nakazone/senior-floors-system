/* global crmNotify */
(function () {
  function isPortal() {
    return !!window.builderAuth?.getToken?.();
  }
  const $ = (id) => document.getElementById(id);

  const VOLUME_DISCOUNTS = [
    { range: '500 - 999 sq ft', pct: 5 },
    { range: '1,000 - 2,499 sq ft', pct: 8 },
    { range: '2,500 - 4,999 sq ft', pct: 12 },
    { range: '5,000+ sq ft', pct: 15 },
  ];

  let portalPricingData = [];
  let portalMeta = {};

  function money(n) {
    return '$' + (Number(n) || 0).toFixed(2);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function adminApi(path, opts) {
    const r = await fetch(path, { credentials: 'include', ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  function renderVolume(el) {
    el.innerHTML = `<ul style="margin:0;padding-left:1.2rem">${VOLUME_DISCOUNTS.map(
      (v) => `<li>${v.range}: <strong>${v.pct}%</strong> off partner rate</li>`
    ).join('')}</ul>`;
  }

  function openInlineCalc(serviceId) {
    const svc = portalPricingData.find((s) => s.id === serviceId);
    if (!svc || svc.is_locked) return;
    let modal = document.getElementById('bpPricingCalcModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'bpPricingCalcModal';
      modal.className = 'bp-modal';
      document.body.appendChild(modal);
    }
    modal.classList.add('open');
    modal.innerHTML = `<div class="bp-modal__box">
      <h2 class="bp-title">${escapeHtml(svc.name)}</h2>
      <p class="bp-muted">Quick estimate at your partner rate</p>
      <label style="font-size:12px;display:block;margin:12px 0 6px">Area (sq ft)
        <input type="number" id="inlineCalcArea" value="1000" min="100" style="width:100%;padding:8px;margin-top:4px;border-radius:8px;border:1px solid var(--bp-border);box-sizing:border-box" />
      </label>
      <div id="inlineCalcResult" class="bp-card hidden" style="margin-top:12px;background:var(--bp-navy);color:#fff"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="bp-btn-tan" id="inlineCalcRun">Calculate</button>
        <button type="button" class="bp-btn-ghost" id="inlineCalcClose">Close</button>
      </div>
    </div>`;
    modal.querySelector('#inlineCalcClose')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
    modal.querySelector('#inlineCalcRun')?.addEventListener('click', async () => {
      const area = parseInt(document.getElementById('inlineCalcArea')?.value, 10) || 0;
      const r = await window.builderAuth.fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: serviceId, area_sqft: area }),
      });
      const j = await r.json();
      const box = document.getElementById('inlineCalcResult');
      if (!r.ok) {
        box.classList.remove('hidden');
        box.textContent = j.error || 'Error';
        return;
      }
      const d = j.data;
      box.classList.remove('hidden');
      box.innerHTML = `<p style="margin:0">${money(d.estimate_low_discounted)} — ${money(d.estimate_high_discounted)}</p>
        <p style="font-size:12px;margin:6px 0 0;opacity:0.85">${d.volume_discount_pct ? d.volume_discount_pct + '% volume discount' : 'Partner rate'}</p>`;
    });
  }

  function printPricingPdf() {
    const w = window.open('', '_blank');
    if (!w) {
      alert('Allow popups to print PDF.');
      return;
    }
    const rows = portalPricingData
      .filter((s) => !s.is_locked)
      .map(
        (s) =>
          `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.category_label || '')}</td><td>${escapeHtml(s.unit || '')}</td><td>${money(s.price_min)} — ${money(s.price_max)}</td><td><strong>${money(s.partner_price)}</strong></td></tr>`
      )
      .join('');
    w.document.write(`<!DOCTYPE html><html><head><title>Partner Pricing</title>
      <style>body{font-family:Inter,sans-serif;padding:32px;color:#1a2036}table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #ddd;padding:8px}th{background:#f5f5f5}</style></head><body>
      <h1>Senior Floors — Partner Pricing</h1>
      <p>${escapeHtml(portalMeta.builder_display_name || 'Partner')} — Valid through ${escapeHtml(portalMeta.valid_through || '—')}</p>
      <table><thead><tr><th>Service</th><th>Category</th><th>Unit</th><th>Public</th><th>Your price</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="font-size:10px;margin-top:24px">Last updated: ${String(portalMeta.last_updated || '').slice(0, 10)}. Confidential partner rates.</p></body></html>`);
    w.document.close();
    w.print();
  }

  async function loadAdmin() {
    const j = await adminApi('/api/pricing');
    const tbody = $('pricingTbody');
    tbody.innerHTML = (j.data || [])
      .map(
        (s) => `<tr data-id="${s.id}">
          <td><input class="bp-inline" data-f="name" value="${escapeHtml(s.name)}" /></td>
          <td><select data-f="category" class="bp-inline">
            <option value="installation" ${s.category === 'installation' ? 'selected' : ''}>Installation</option>
            <option value="sand_finish" ${s.category === 'sand_finish' ? 'selected' : ''}>Sand & Finish</option>
            <option value="supply" ${s.category === 'supply' ? 'selected' : ''}>Supply</option>
            <option value="custom" ${s.category === 'custom' ? 'selected' : ''}>Custom</option>
          </select></td>
          <td><input class="bp-inline" data-f="unit" value="${escapeHtml(s.unit || '')}" style="width:70px" /></td>
          <td><input class="bp-inline" data-f="price_min" type="number" step="0.01" value="${s.price_min}" style="width:72px" /></td>
          <td><input class="bp-inline" data-f="price_max" type="number" step="0.01" value="${s.price_max}" style="width:72px" /></td>
          <td><input class="bp-inline" data-f="partner_price" type="number" step="0.01" value="${s.partner_price}" style="width:72px" /></td>
          <td><input type="checkbox" data-f="is_visible" ${s.is_visible ? 'checked' : ''} /></td>
          <td><input type="checkbox" data-f="is_locked" ${s.is_locked ? 'checked' : ''} /></td>
          <td><button type="button" class="bp-btn-tan bp-btn-sm" data-save="${s.id}">Save</button></td>
        </tr>`
      )
      .join('');
    renderVolume($('volumeDiscounts'));
    tbody.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(btn.dataset.save));
    });
  }

  async function saveRow(id) {
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    const body = {};
    tr.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      if (el.type === 'checkbox') body[f] = el.checked;
      else body[f] = el.type === 'number' ? parseFloat(el.value) : el.value;
    });
    try {
      await adminApi(`/api/pricing/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      crmNotify('Saved.', 'success');
    } catch (e) {
      crmNotify(e.message, 'error');
    }
  }

  async function loadPortal() {
    $('adminShell')?.classList.add('hidden');
    $('portalShell')?.classList.remove('hidden');
    const r = await window.builderAuth.fetch('/api/pricing/partner');
    const j = await r.json();
    portalPricingData = j.data || [];
    portalMeta = j.meta || {};
    const root = $('portalPricingRoot');
    const validLine = portalMeta.valid_through
      ? `Table valid through <strong>${escapeHtml(portalMeta.valid_through)}</strong> — Last updated ${escapeHtml(String(portalMeta.last_updated || '').slice(0, 10))}`
      : 'Partner rates — contact Senior Floors for an updated table.';
    const rows = portalPricingData
      .map((s) => {
        if (s.is_locked) {
          return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.category_label || '')}</td><td colspan="3"><em>Contact your manager</em> <a href="builder-messages.html" class="bp-btn-tan bp-btn-sm" style="text-decoration:none;margin-left:8px">Request quote</a></td></tr>`;
        }
        const noteIcon = s.notes
          ? `<button type="button" class="bp-info-btn" title="${escapeHtml(s.notes)}">i</button>`
          : '';
        return `<tr>
          <td>${escapeHtml(s.name)} ${noteIcon}</td>
          <td>${escapeHtml(s.category_label || '')}</td>
          <td>${escapeHtml(s.unit || '')}</td>
          <td>${money(s.price_min)} — ${money(s.price_max)}</td>
          <td><span class="bp-badge bp-badge--active">${money(s.partner_price)}</span>
            <button type="button" class="bp-btn-ghost bp-btn-sm" data-calc="${s.id}" style="margin-left:6px">Calc</button></td>
        </tr>`;
      })
      .join('');
    root.innerHTML = `
      <div id="bpPortalHeader"></div>
      <h1 class="bp-title">Partner pricing</h1>
      <p class="bp-muted">${validLine}</p>
      <div style="margin-bottom:12px">
        <button type="button" class="bp-btn-ghost" id="btnDownloadPricing">Download PDF</button>
      </div>
      <div class="bp-table-wrap"><table class="bp-table"><thead><tr><th>Service</th><th>Category</th><th>Unit</th><th>Public range</th><th>Your price</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h2 style="font-size:1rem;margin-top:1.5rem">Volume discounts</h2>
      <div class="bp-card" id="volPortal"></div>
      <p style="margin-top:1rem"><a href="builder-calculator.html" class="bp-btn-tan" style="text-decoration:none;display:inline-block;margin-right:8px">Open calculator</a>
      <a href="builder-estimate-request.html" class="bp-btn-ghost" style="text-decoration:none;display:inline-block">Request formal estimate</a></p>`;
    renderVolume($('volPortal'));
    document.getElementById('btnDownloadPricing')?.addEventListener('click', printPricingPdf);
    root.querySelectorAll('[data-calc]').forEach((btn) => {
      btn.addEventListener('click', () => openInlineCalc(parseInt(btn.dataset.calc, 10)));
    });
    root.querySelectorAll('.bp-info-btn').forEach((btn) => {
      btn.addEventListener('click', () => alert(btn.title || ''));
    });
  }

  async function init() {
    if (isPortal()) {
      await loadPortal();
      return;
    }
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    $('btnAddService')?.addEventListener('click', async () => {
      try {
        await adminApi('/api/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New service', category: 'installation' }),
        });
        await loadAdmin();
        crmNotify('Service added.', 'success');
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });
    await loadAdmin();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(init, isPortal() ? 120 : 0);
  });
})();
