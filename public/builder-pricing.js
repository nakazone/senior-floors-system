/* global crmNotify */
(function () {
  function isPortal() {
    return !!window.builderAuth?.getToken?.();
  }
  const $ = (id) => document.getElementById(id);

  const VOLUME_DISCOUNTS = [
    { range: '500 ù 999 sq ft', pct: 5 },
    { range: '1,000 ù 2,499 sq ft', pct: 8 },
    { range: '2,500 ù 4,999 sq ft', pct: 12 },
    { range: '5,000+ sq ft', pct: 15 },
  ];

  function money(n) {
    return '$' + (Number(n) || 0).toFixed(2);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
          <td><button type="button" class="bp-btn-tan bp-btn-sm" data-save="${s.id}">Guardar</button></td>
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
      crmNotify('Guardado.', 'success');
    } catch (e) {
      crmNotify(e.message, 'error');
    }
  }

  async function loadPortal() {
    $('adminShell').classList.add('hidden');
    $('portalShell').classList.remove('hidden');
    const r = await window.builderAuth.fetch('/api/pricing/partner');
    const j = await r.json();
    const root = $('portalPricingRoot');
    const rows = (j.data || [])
      .map((s) => {
        if (s.is_locked) {
          return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.category_label || '')}</td><td colspan="3"><em>Contact your manager</em> <a href="builder-messages.html" class="bp-btn-tan bp-btn-sm" style="text-decoration:none;margin-left:8px">Request quote</a></td></tr>`;
        }
        return `<tr>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.category_label || '')}</td>
          <td>${escapeHtml(s.unit || '')}</td>
          <td>${money(s.price_min)} ù ${money(s.price_max)}</td>
          <td><span class="bp-badge bp-badge--active">Your price ${money(s.partner_price)}</span></td>
        </tr>`;
      })
      .join('');
    root.innerHTML = `
      <h1 class="bp-title">Partner pricing</h1>
      <p class="bp-muted">Exclusive rates for Senior Floors partners.</p>
      <div class="bp-table-wrap"><table class="bp-table"><thead><tr><th>Service</th><th>Category</th><th>Unit</th><th>Public range</th><th>Your price</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h2 style="font-size:1rem;margin-top:1.5rem">Volume discounts</h2>
      <div class="bp-card" id="volPortal"></div>
      <p style="margin-top:1rem"><a href="builder-estimate-request.html" class="bp-btn-tan" style="text-decoration:none;display:inline-block">Request formal estimate</a></p>`;
    renderVolume($('volPortal'));
  }

  async function init() {
    if (isPortal()) {
      if (!window.builderAuth.requireAuth()) return;
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
        crmNotify('Serviùo adicionado.', 'success');
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });
    await loadAdmin();
  }

  init();
})();
