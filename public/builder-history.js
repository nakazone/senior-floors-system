(function () {
  if (!window.builderAuth.requireAuth()) return;
  let rows = [];

  function money(n) {
    return n != null ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-history');
    const j = await r.json();
    rows = j.data || [];
    const tbody = document.getElementById('histBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">No completed projects yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(
        (p) => `<tr>
          <td>${p.project_number || p.name || '#' + p.id}</td>
          <td>${p.address || '—'}</td>
          <td>${p.flooring_type || '—'}</td>
          <td>${p.total_sqft ? p.total_sqft + ' sqft' : '—'}</td>
          <td>${money(p.contract_value)}</td>
          <td>${(p.end_date_actual || '').toString().slice(0, 10) || '—'}</td>
        </tr>`
      )
      .join('');
  }

  document.getElementById('btnExport').addEventListener('click', () => {
    const header = ['Project', 'Address', 'Floor', 'Sqft', 'Value', 'Completed'];
    const lines = [
      header.join(','),
      ...rows.map((p) =>
        [
          p.project_number || p.id,
          `"${(p.address || '').replace(/"/g, '""')}"`,
          p.flooring_type || '',
          p.total_sqft || '',
          p.contract_value || '',
          p.end_date_actual || '',
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'senior-floors-projects.csv';
    a.click();
  });

  load();
})();
