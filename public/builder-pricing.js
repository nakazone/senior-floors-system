/**
 * Builder portal — partner pricing (read-only static table).
 */
(function () {
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

  function noteTooltipHtml(notes) {
    if (!notes) return '';
    return `<span class="bp-tooltip-wrap">
      <button type="button" class="bp-info-btn" aria-label="Service notes">i</button>
      <span class="bp-tooltip" role="tooltip">${escapeHtml(notes)}</span>
    </span>`;
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

  async function fetchPricingPdfBlob() {
    const r = await window.builderAuth.fetch('/api/pricing/partner/pdf');
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || 'Could not generate PDF');
    }
    return r.blob();
  }

  function setPdfButtonsLoading(loading) {
    ['btnViewPricingPdf', 'btnDownloadPricing'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = loading;
    });
    const viewBtn = document.getElementById('btnViewPricingPdf');
    const dlBtn = document.getElementById('btnDownloadPricing');
    if (!loading) {
      if (viewBtn) viewBtn.textContent = 'View PDF';
      if (dlBtn) dlBtn.textContent = 'Download PDF';
    } else {
      if (viewBtn) viewBtn.textContent = 'Loading...';
      if (dlBtn) dlBtn.textContent = 'Loading...';
    }
  }

  async function viewPricingPdf() {
    setPdfButtonsLoading(true);
    try {
      const blob = await fetchPricingPdfBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      alert(e.message || 'PDF error');
    } finally {
      setPdfButtonsLoading(false);
    }
  }

  async function downloadPricingPdf() {
    setPdfButtonsLoading(true);
    try {
      const blob = await fetchPricingPdfBlob();
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `senior-floors-partner-pricing-${stamp}.pdf`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(e.message || 'PDF error');
    } finally {
      setPdfButtonsLoading(false);
    }
  }

  async function loadPortal() {
    const r = await window.builderAuth.fetch('/api/pricing/partner');
    const j = await r.json();
    if (!r.ok || !j.success) {
      $('portalPricingRoot').innerHTML = `<p class="bp-card">${escapeHtml(j.error || 'Could not load pricing')}</p>`;
      return;
    }
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
      <p class="bp-muted">Read-only partner rate sheet. Contact Senior Floors to request changes.</p>
      <p class="bp-muted">${validLine}</p>
      <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" class="bp-btn-ghost" id="btnViewPricingPdf">View PDF</button>
        <button type="button" class="bp-btn-tan" id="btnDownloadPricing">Download PDF</button>
      </div>
      <div class="bp-table-wrap"><table class="bp-table"><thead><tr><th>Service</th><th>Category</th><th>Unit</th><th>Public range</th><th>Your price</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h2 style="font-size:1rem;margin-top:1.5rem">Volume discounts</h2>
      <div class="bp-card" id="volPortal"></div>
      <p style="margin-top:1rem"><a href="builder-calculator.html" class="bp-btn-tan" style="text-decoration:none;display:inline-block;margin-right:8px">Open calculator</a>
      <a href="builder-estimate-request.html" class="bp-btn-ghost" style="text-decoration:none;display:inline-block">Request formal estimate</a></p>`;
    renderVolume($('volPortal'));
    document.getElementById('btnViewPricingPdf')?.addEventListener('click', viewPricingPdf);
    document.getElementById('btnDownloadPricing')?.addEventListener('click', downloadPricingPdf);
    root.querySelectorAll('[data-calc]').forEach((btn) => {
      btn.addEventListener('click', () => openInlineCalc(parseInt(btn.dataset.calc, 10)));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const boot = window.builderPortalCommon?.whenPortalReady;
    if (typeof boot === 'function') {
      boot().then((ok) => {
        if (ok) loadPortal();
      });
    } else if (window.builderAuth?.requireAuth?.()) {
      loadPortal();
    }
  });
})();
