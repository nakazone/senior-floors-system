(function () {
  if (!window.builderAuth.requireAuth()) return;

  const COMPLETED = new Set(['completed', 'closed', 'cancelled']);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.getElementById('btnLogout').addEventListener('click', () => {
    window.builderAuth.setToken(null);
    location.href = 'builder-login.html';
  });

  async function load() {
    const meR = await window.builderAuth.fetch('/api/builder-auth/me');
    const meJ = await meR.json();
    if (!meJ.success) return;
    const b = meJ.data;
    const name = [b.first_name, b.last_name].filter(Boolean).join(' ');
    document.getElementById('portalUserName').textContent = name;
    document.getElementById('portalUserCo').textContent = b.company || '';
    document.getElementById('welcomeTitle').textContent = `Hello, ${b.first_name || name}`;

    const pr = await window.builderAuth.fetch('/api/builder-projects');
    const pj = await pr.json();
    const el = document.getElementById('projectCards');

    if (!pr.ok || !pj.success) {
      el.innerHTML = `<p class="bp-card" style="border-color:#fecaca">${escapeHtml(pj.error || 'Could not load projects')}</p>`;
      return;
    }

    const all = pj.data || [];
    const projects = all.filter((p) => !COMPLETED.has(String(p.status || '').toLowerCase()));

    document.getElementById('metricActive').textContent = String(projects.length);
    const totalEl = document.getElementById('metricTotal');
    if (totalEl) totalEl.textContent = String(all.length);

    if (!projects.length) {
      el.innerHTML =
        '<p class="bp-card">No active projects yet. <a href="builder-estimate-request.html">Request an estimate</a> or see <a href="builder-projects.html">all projects</a>.</p>';
      return;
    }
    el.innerHTML = projects
      .slice(0, 6)
      .map(
        (p) => `<div class="bp-card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <strong>${escapeHtml(p.name || p.project_number || 'Project')}</strong>
            <p style="margin:4px 0 0;font-size:13px;color:var(--bp-muted)">${escapeHtml(p.address || '')}</p>
            <div style="margin-top:8px;height:6px;background:#e2e8f0;border-radius:4px;max-width:200px">
              <div style="width:${Math.min(100, p.completion_percentage || 0)}%;height:100%;background:var(--bp-tan);border-radius:4px"></div>
            </div>
          </div>
          <a href="builder-project.html?id=${p.id}" class="bp-btn-tan" style="text-decoration:none">View details</a>
        </div>`
      )
      .join('');
  }

  load().catch((e) => {
    const el = document.getElementById('projectCards');
    if (el) el.innerHTML = `<p class="bp-card">${escapeHtml(e.message)}</p>`;
  });
})();
