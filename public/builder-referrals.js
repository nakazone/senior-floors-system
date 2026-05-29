(function () {
  if (!window.builderAuth.requireAuth()) return;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-referrals');
    const j = await r.json();
    const host = document.getElementById('refList');
    const items = j.data || [];
    if (!items.length) {
      host.innerHTML = '<p class="bp-card">No referrals yet. Submit an estimate request to get started.</p>';
      return;
    }
    host.innerHTML = items
      .map((it) => {
        const badge =
          it.type === 'estimate'
            ? `<span class="bp-badge bp-badge--pending">Estimate</span>`
            : `<span class="bp-badge bp-badge--active">Lead</span>`;
        return `<div class="bp-card" style="margin-bottom:10px">
          ${badge}
          <strong>${escapeHtml(it.title)}</strong>
          <span class="bp-badge bp-badge--${it.status === 'won' || it.status === 'quoted' ? 'active' : 'pending'}" style="margin-left:8px">${escapeHtml(it.status)}</span>
          <p class="bp-muted" style="margin:6px 0 0">${escapeHtml(String(it.created_at).slice(0, 16))}${it.address ? ' — ' + escapeHtml(it.address) : ''}</p>
        </div>`;
      })
      .join('');
  }

  load();
})();
