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
  let adminCanEdit = false;

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

  function noteTooltipHtml(notes) {
    if (!notes) return '';
    return `<span class="bp-tooltip-wrap">
      <button type="button" class="bp-info-btn" aria-label="Service notes">i</button>
      <span class="bp-tooltip" role="tooltip">${escapeHtml(notes)}</span>
    </span>`;
  }

  async function adminApi(path, opts) {
    const r = await fetch(path, { credentials: 'include', ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  function renderVolume(el) {
    if (!el) return;
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
      box.innerHTML = `<p style="margin:0">${money(d.estimate_low_discounted)} - ${money(d.estimate_high_discounted)}</p>
        <p style="font-size:12px;margin:6px 0 0;opacity:0.85">${d.volume_discount_pct ? d.volume_discount_pct + '% volume discount' : 'Partner rate'}</p>`;
    });
  }

  async function downloadPricingPdf() {
    const btn = document.getElementById('btnDownloadPricing');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generating PDF...';
    }
    try {
      const r = await window.builderAuth.fetch('/api/pricing/partner/pdf');
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Could not generate PDF');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      alert(e.message || 'PDF error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Download PDF';
      }
    }
  }

  function adminRowHtml(s) {
    const dis = adminCanEdit ? '' : ' disabled';
    return `<tr data-id="${s.id}">
          <td><input class="bp-inline" data-f="sort_order" type="number" value="${s.sort_order ?? 0}" style="width:44px"${dis} /></td>
          <td><input class="bp-inline" data-f="name" value="${escapeHtml(s.name)}"${dis} /></td>
          <td><select data-f="category" class="bp-inline"${dis}>
            <option value="installation" ${s.category === 'installation' ? 'selected' : ''}>Installation</option>
            <option value="sand_finish" ${s.category === 'sand_finish' ? 'selected' : ''}>Sand & Finish</option>
            <option value="supply" ${s.category === 'supply' ? 'selected' : ''}>Supply</option>
            <option value="custom" ${s.category === 'custom' ? 'selected' : ''}>Custom</option>
          </select></td>
          <td><input class="bp-inline" data-f="unit" value="${escapeHtml(s.unit || '')}" style="width:70px"${dis} /></td>
          <td><input class="bp-inline" data-f="price_min" type="number" step="0.01" value="${s.price_min}" style="width:72px"${dis} /></td>
          <td><input class="bp-inline" data-f="price_max" type="number" step="0.01" value="${s.price_max}" style="width:72px"${dis} /></td>
          <td><input class="bp-inline" data-f="partner_price" type="number" step="0.01" value="${s.partner_price}" style="width:72px"${dis} /></td>
          <td><textarea class="bp-inline bp-inline-notes" data-f="notes" rows="2" placeholder="Nota para o builder..."${dis}>${escapeHtml(s.notes || '')}</textarea></td>
          <td><input type="checkbox" data-f="is_visible" ${s.is_visible ? 'checked' : ''}${dis} /></td>
          <td><input type="checkbox" data-f="is_locked" ${s.is_locked ? 'checked' : ''}${dis} /></td>
          <td style="white-space:nowrap">
            ${adminCanEdit ? `<button type="button" class="bp-btn-tan bp-btn-sm" data-save="${s.id}">Salvar</button>
            <button type="button" class="bp-btn-ghost bp-btn-sm" data-del="${s.id}" style="margin-left:4px">Excluir</button>` : ''}
          </td>
        </tr>`;
  }

  async function loadAdmin() {
    const j = await adminApi('/api/pricing');
    const tbody = $('pricingTbody');
    tbody.innerHTML = (j.data || []).map(adminRowHtml).join('');
    renderVolume($('volumeDiscounts'));
    if (!adminCanEdit) return;
    tbody.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(btn.dataset.save));
    });
    tbody.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteRow(btn.dataset.del));
    });
  }

  async function saveRow(id) {
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    const body = {};
    tr.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      if (el.type === 'checkbox') body[f] = el.checked;
      else if (f === 'notes') body[f] = el.value;
      else body[f] = el.type === 'number' ? parseFloat(el.value) : el.value;
    });
    try {
      await adminApi(`/api/pricing/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      crmNotify('Salvo.', 'success');
    } catch (e) {
      crmNotify(e.message, 'error');
    }
  }

  async function deleteRow(id) {
    if (!confirm('Excluir este servico da tabela?')) return;
    try {
      await adminApi(`/api/pricing/${id}`, { method: 'DELETE' });
      crmNotify('Servico removido.', 'success');
      await loadAdmin();
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
      ? `Table valid through <strong>${escapeHtml(portalMeta.valid_through)}</strong> - Last updated ${escapeHtml(String(portalMeta.last_updated || '').slice(0, 10))}`
      : 'Partner rates - contact Senior Floors for an updated table.';
    const rows = portalPricingData
      .map((s) => {
        if (s.is_locked) {
          return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.category_label || '')}</td><td colspan="3"><em>Contact your manager</em> <a href="builder-messages.html" class="bp-btn-tan bp-btn-sm" style="text-decoration:none;margin-left:8px">Request quote</a></td></tr>`;
        }
        return `<tr>
          <td>${escapeHtml(s.name)} ${noteTooltipHtml(s.notes)}</td>
          <td>${escapeHtml(s.category_label || '')}</td>
          <td>${escapeHtml(s.unit || '')}</td>
          <td>${money(s.price_min)} - ${money(s.price_max)}</td>
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
    document.getElementById('btnDownloadPricing')?.addEventListener('click', downloadPricingPdf);
    root.querySelectorAll('[data-calc]').forEach((btn) => {
      btn.addEventListener('click', () => openInlineCalc(parseInt(btn.dataset.calc, 10)));
    });
  }

  async function init() {
    if (isPortal()) {
      const boot = window.builderPortalCommon?.whenPortalReady;
      const run = () => loadPortal();
      if (typeof boot === 'function') {
        boot().then((ok) => {
          if (ok) run();
        });
      } else if (window.builderAuth?.getToken()) {
        run();
      }
      return;
    }
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    const perms = sess.permissions || sess.user?.permissions || [];
    adminCanEdit = sess.role === 'admin' || perms.includes('builders.edit');
    if (!adminCanEdit) {
      $('adminReadOnlyBanner')?.classList.remove('hidden');
      $('btnAddService')?.setAttribute('disabled', 'disabled');
    }
    $('btnAddService')?.addEventListener('click', async () => {
      if (!adminCanEdit) return;
      try {
        await adminApi('/api/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New service', category: 'installation' }),
        });
        await loadAdmin();
        crmNotify('Servico adicionado.', 'success');
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
