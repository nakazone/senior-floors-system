(function () {
  let services = [];
  let lastResult = null;

  function fmt(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function serviceOptions(selectedId) {
    return services
      .filter((s) => !s.is_locked)
      .map(
        (s) =>
          `<option value="${s.id}"${String(s.id) === String(selectedId) ? ' selected' : ''}>${escapeHtml(s.name)} (${s.unit}) — ${fmt(s.partner_price)}</option>`
      )
      .join('');
  }

  function addLineRow(serviceId = '', area = 1000) {
    const host = document.getElementById('calcLines');
    const row = document.createElement('div');
    row.className = 'bp-calc-line';
    row.innerHTML = `
      <select class="calc-svc">${serviceOptions(serviceId)}</select>
      <input type="number" class="calc-area" min="100" value="${area}" placeholder="sq ft" />
      <button type="button" class="bp-btn-ghost bp-calc-line-remove" title="Remove">&times;</button>`;
    host.appendChild(row);
    row.querySelector('.bp-calc-line-remove')?.addEventListener('click', () => {
      if (host.querySelectorAll('.bp-calc-line').length > 1) row.remove();
    });
  }

  function gatherLines() {
    return [...document.querySelectorAll('.bp-calc-line')].map((row) => ({
      service_id: parseInt(row.querySelector('.calc-svc')?.value, 10),
      area_sqft: parseInt(row.querySelector('.calc-area')?.value, 10) || 0,
    }));
  }

  async function loadServices() {
    const r = await window.builderAuth.fetch('/api/pricing/partner');
    const j = await r.json();
    services = j.data || [];
    if (!document.querySelector('.bp-calc-line')) {
      addLineRow(services[0]?.id, 1000);
    }
  }

  async function loadRecent() {
    const host = document.getElementById('calcRecent');
    try {
      const r = await window.builderAuth.fetch('/api/builder-calculations?limit=5');
      const j = await r.json();
      const rows = j.data || [];
      if (!rows.length) {
        host.innerHTML = '<p class="bp-muted bp-card">No saved estimates yet.</p>';
        return;
      }
      host.innerHTML = rows
        .map(
          (c) => `<div class="bp-card" style="margin-bottom:8px;font-size:13px">
          <strong>${escapeHtml(c.label || 'Estimate #' + c.id)}</strong>
          <span class="bp-muted" style="margin-left:8px">${String(c.created_at).slice(0, 10)}</span>
          <p style="margin:4px 0 0">${fmt(c.total_low)} — ${fmt(c.total_high)} — ${c.area_sqft_total || '—'} sq ft</p>
        </div>`
        )
        .join('');
    } catch {
      host.innerHTML = '';
    }
  }

  document.getElementById('btnAddLine')?.addEventListener('click', () => addLineRow(services[0]?.id, 1000));

  document.getElementById('btnCalc')?.addEventListener('click', async () => {
    const items = gatherLines().filter((x) => x.service_id && x.area_sqft > 0);
    if (!items.length) {
      alert('Add at least one service with area.');
      return;
    }
    const r = await window.builderAuth.fetch('/api/pricing/calculate-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || 'Error');
      return;
    }
    lastResult = j.data;
    const t = j.data.totals;
    document.getElementById('calcResult').classList.remove('hidden');
    document.getElementById('calcRange').textContent = `${fmt(t.estimate_low_discounted)} — ${fmt(t.estimate_high_discounted)}`;
    const volLines = j.data.lines.filter((l) => l.volume_discount_pct > 0);
    document.getElementById('calcVol').textContent = volLines.length
      ? `Volume discounts applied on ${volLines.length} line(s)`
      : 'Based on your partner rates';
    const savings = j.data.lines.reduce((s, l) => s + (l.public_savings_low || 0), 0);
    document.getElementById('calcSavings').textContent =
      savings > 0 ? `You save approximately ${fmt(savings)} vs public pricing` : '';

    const bd = document.getElementById('calcBreakdown');
    bd.classList.remove('hidden');
    bd.innerHTML = `<h3 style="margin:0 0 10px;font-size:14px">Breakdown</h3>
      <table class="bp-table"><thead><tr><th>Service</th><th>Area</th><th>Range</th></tr></thead>
      <tbody>${j.data.lines
        .map(
          (l) =>
            `<tr><td>${escapeHtml(l.service)}</td><td>${l.area_sqft} ${escapeHtml(l.unit || '')}</td><td>${fmt(l.estimate_low_discounted)} — ${fmt(l.estimate_high_discounted)}</td></tr>`
        )
        .join('')}</tbody></table>`;
  });

  document.getElementById('btnSaveCalc')?.addEventListener('click', async () => {
    if (!lastResult) {
      alert('Calculate first.');
      return;
    }
    const label = prompt('Label for this estimate (optional):', 'Quick estimate');
    const r = await window.builderAuth.fetch('/api/builder-calculations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: label || null,
        items: lastResult.lines,
        totals: lastResult.totals,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || 'Could not save');
      return;
    }
    alert('Estimate saved.');
    loadRecent();
  });

  document.getElementById('btnShareCalc')?.addEventListener('click', async () => {
    if (!lastResult) {
      alert('Calculate first.');
      return;
    }
    const r = await window.builderAuth.fetch('/api/builder-calculations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: lastResult.lines, totals: lastResult.totals }),
    });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || 'Could not create share link');
      return;
    }
    const url = `${location.origin}${j.data.share_path}`;
    try {
      await navigator.clipboard.writeText(url);
      alert('Share link copied to clipboard.');
    } catch {
      prompt('Copy this link:', url);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
      if (!window.builderAuth?.getToken()) return;
      await loadServices();
      loadRecent();
      const params = new URLSearchParams(location.search);
      if (params.get('service_id')) addLineRow(params.get('service_id'), params.get('sqft') || 1000);
    }, 120);
  });
})();
