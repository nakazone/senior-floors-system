(function () {
  const STATUS_LABELS = {
    pending: 'Submitted',
    reviewing: 'Under review',
    quoted: 'Quote sent',
    won: 'Accepted',
    lost: 'Declined',
    new_lead: 'Received',
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function statusLabel(s) {
    return STATUS_LABELS[String(s || '').toLowerCase()] || s || '—';
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-referrals');
    const j = await r.json();
    const host = document.getElementById('refList');
    const items = j.data || [];
    const estimates = items.filter((it) => it.type === 'estimate');
    const converted = items.filter((it) => ['won', 'quoted'].includes(String(it.status || '').toLowerCase()));

    const summary = document.getElementById('refSummary');
    if (summary) {
      summary.innerHTML = `
        <div class="bp-metrics">
          <div class="bp-card bp-metric"><div class="bp-metric__val">${items.length}</div><div class="bp-metric__lbl">Submitted</div></div>
          <div class="bp-card bp-metric"><div class="bp-metric__val">${converted.length}</div><div class="bp-metric__lbl">In progress / won</div></div>
          <div class="bp-card bp-metric"><div class="bp-metric__val">${estimates.length}</div><div class="bp-metric__lbl">Estimate requests</div></div>
        </div>`;
    }

    if (!items.length) {
      host.innerHTML =
        '<p class="bp-card">No referrals yet. <a href="builder-estimate-request.html">Submit an estimate request</a> to get started.</p>';
      return;
    }
    host.innerHTML = `<div class="bp-table-wrap"><table class="bp-table"><thead><tr>
      <th>Reference</th><th>Type</th><th>Status</th><th>Address</th><th>Date</th></tr></thead><tbody>${items
      .map((it) => {
        const ref = it.ref_number || it.title || `#${it.id}`;
        return `<tr>
          <td><strong>${escapeHtml(ref)}</strong></td>
          <td>${escapeHtml(it.type === 'estimate' ? 'Estimate' : 'Lead')}</td>
          <td><span class="bp-badge bp-badge--pending">${escapeHtml(statusLabel(it.status))}</span></td>
          <td>${escapeHtml(it.address || '—')}</td>
          <td>${escapeHtml(String(it.created_at || '').slice(0, 10))}</td>
        </tr>`;
      })
      .join('')}</tbody></table></div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.builderAuth?.getToken()) load();
    }, 120);
  });
})();
