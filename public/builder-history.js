(function () {
  let rows = [];
  let summary = { project_count: 0, total_sqft: 0, total_value: 0 };
  let searchQ = '';
  let yearFilter = '';

  function money(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
      Number(n) || 0
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function filtered() {
    let list = rows;
    if (yearFilter) list = list.filter((p) => p.completed_year === yearFilter);
    const q = searchQ.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const hay = [p.name, p.address, p.project_number, p.flooring_type].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }

  function renderSummary() {
    const el = document.getElementById('histSummary');
    if (!el) return;
    el.innerHTML = `
      <div class="bp-card bp-metric"><div class="bp-metric__val">${summary.project_count}</div><div class="bp-metric__lbl">Projects completed</div></div>
      <div class="bp-card bp-metric"><div class="bp-metric__val">${Math.round(summary.total_sqft || 0).toLocaleString()}</div><div class="bp-metric__lbl">Sq ft installed</div></div>
      <div class="bp-card bp-metric"><div class="bp-metric__val">${money(summary.total_value)}</div><div class="bp-metric__lbl">Total project value</div></div>`;
  }

  function renderTable() {
    const list = filtered();
    const tbody = document.getElementById('histBody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7">No completed projects in this view.</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map((p) => {
        const title = p.project_number || p.name || `#${p.id}`;
        const photos =
          p.photo_count > 0
            ? `<a href="builder-project.html?id=${p.id}">${p.photo_count} photos</a>`
            : '—';
        return `<tr>
          <td>${escapeHtml(title)}</td>
          <td>${escapeHtml(p.address || '—')}</td>
          <td>${escapeHtml(p.flooring_type || '—')}</td>
          <td>${p.total_sqft ? p.total_sqft + ' sqft' : '—'}</td>
          <td>${money(p.contract_value)}</td>
          <td>${escapeHtml(String(p.end_date_actual || '').slice(0, 10) || '—')}</td>
          <td>${photos}</td>
        </tr>`;
      })
      .join('');
  }

  function populateYears() {
    const sel = document.getElementById('histYear');
    const years = [...new Set(rows.map((p) => p.completed_year).filter(Boolean))].sort().reverse();
    years.forEach((y) => {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = y;
      sel.appendChild(o);
    });
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-history');
    const j = await r.json();
    rows = j.data || [];
    summary = j.summary || summary;
    renderSummary();
    populateYears();
    renderTable();
  }

  document.getElementById('histSearch')?.addEventListener('input', (e) => {
    searchQ = e.target.value;
    renderTable();
  });
  document.getElementById('histYear')?.addEventListener('change', (e) => {
    yearFilter = e.target.value;
    renderTable();
  });

  document.getElementById('btnExportCsv')?.addEventListener('click', () => {
    const list = filtered();
    const header = ['Project', 'Address', 'Floor', 'Sqft', 'Value', 'Completed', 'Photos'];
    const lines = [
      header.join(','),
      ...list.map((p) =>
        [
          p.project_number || p.id,
          `"${(p.address || '').replace(/"/g, '""')}"`,
          p.flooring_type || '',
          p.total_sqft || '',
          p.contract_value || '',
          p.end_date_actual || '',
          p.photo_count || 0,
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'senior-floors-completed-projects.csv';
    a.click();
  });

  document.getElementById('btnExportPdf')?.addEventListener('click', () => {
    const list = filtered();
    const print = document.getElementById('histPrintArea');
    print.classList.remove('hidden');
    print.innerHTML = `
      <div class="bp-print-doc">
        <img src="/assets/SeniorFloors.png" alt="" width="80" onerror="this.style.display='none'" />
        <h1>Senior Floors — Completed Projects</h1>
        <p>${summary.project_count} projects — ${Math.round(summary.total_sqft)} sq ft — ${money(summary.total_value)} total value</p>
        <table><thead><tr><th>Project</th><th>Address</th><th>Floor</th><th>Sqft</th><th>Value</th><th>Completed</th></tr></thead>
        <tbody>${list
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.name || p.project_number || '')}</td><td>${escapeHtml(p.address || '')}</td><td>${escapeHtml(p.flooring_type || '')}</td><td>${p.total_sqft || ''}</td><td>${money(p.contract_value)}</td><td>${String(p.end_date_actual || '').slice(0, 10)}</td></tr>`
          )
          .join('')}</tbody></table>
        <p style="font-size:11px;margin-top:24px;color:#666">Generated ${new Date().toLocaleDateString()} — Senior Floors Builder Portal</p>
      </div>`;
    const w = window.open('', '_blank');
    if (!w) {
      alert('Allow popups to export PDF, or use Print on this page.');
      return;
    }
    w.document.write(`<html><head><title>Project History</title><style>
      body{font-family:Inter,sans-serif;padding:24px;color:#1a2036}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}
      th,td{border:1px solid #e2e8f0;padding:8px;text-align:left}
      th{background:#f8f9fc}
    </style></head><body>${print.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
    print.classList.add('hidden');
  });

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.builderAuth?.getToken()) load();
    }, 120);
  });
})();
