(function () {
  if (!window.builderAuth.requireAuth()) return;

  const host = document.getElementById('projectsHost');
  let allProjects = [];
  let filter = 'active';
  let searchQ = '';

  const COMPLETED = new Set(['completed', 'closed', 'cancelled']);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const cls =
      COMPLETED.has(s) ? 'bp-badge--pending' : s === 'in_progress' ? 'bp-badge--active' : 'bp-badge--pending';
    return `<span class="bp-badge ${cls}">${escapeHtml(status || 'unknown')}</span>`;
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  }

  function filtered() {
    let rows = allProjects;
    if (filter === 'completed') {
      rows = rows.filter((p) => COMPLETED.has(String(p.status || '').toLowerCase()));
    } else if (filter !== 'all') {
      rows = rows.filter((p) => !COMPLETED.has(String(p.status || '').toLowerCase()));
    }
    const q = searchQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p) => {
        const hay = [p.name, p.address, p.project_number, p.flooring_type].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }

  function renderList() {
    const rows = filtered();
    if (!rows.length) {
      host.innerHTML =
        '<p class="bp-card">No projects in this view. <a href="builder-estimate-request.html">Request an estimate</a> to get started.</p>';
      return;
    }
    host.innerHTML = rows
      .map((p) => {
        const pct = Math.min(100, Number(p.completion_percentage) || 0);
        const title = p.name || p.project_number || `Project #${p.id}`;
        return `<div class="bp-card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div style="flex:1;min-width:200px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <strong>${escapeHtml(title)}</strong>
              ${statusBadge(p.status)}
            </div>
            <p style="margin:4px 0 0;font-size:13px;color:var(--bp-muted)">${escapeHtml(p.address || '')}</p>
            ${p.flooring_type ? `<p style="margin:4px 0 0;font-size:12px;color:var(--bp-muted)">${escapeHtml(p.flooring_type)}${p.total_sqft ? ' - ' + p.total_sqft + ' sqft' : ''}</p>` : ''}
            <div style="margin-top:8px;height:6px;background:#e2e8f0;border-radius:4px;max-width:240px">
              <div style="width:${pct}%;height:100%;background:var(--bp-tan);border-radius:4px"></div>
            </div>
            <p style="margin:4px 0 0;font-size:11px;color:var(--bp-muted)">${pct}% complete</p>
          </div>
          <a href="builder-project.html?id=${p.id}" class="bp-btn-tan" style="text-decoration:none;white-space:nowrap">View details</a>
        </div>`;
      })
      .join('');
  }

  document.getElementById('btnLogout')?.addEventListener('click', () => {
    window.builderAuth.setToken(null);
    location.href = 'builder-login.html';
  });

  document.getElementById('projSearch')?.addEventListener('input', (e) => {
    searchQ = e.target.value;
    renderList();
  });

  document.querySelectorAll('.bp-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      document.querySelectorAll('.bp-filter-btn').forEach((b) => {
        b.classList.toggle('bp-btn-tan', b === btn);
        b.classList.toggle('btn-secondary', b !== btn);
        b.classList.toggle('active', b === btn);
      });
      renderList();
    });
  });

  async function load() {
    const meR = await window.builderAuth.fetch('/api/builder-auth/me');
    const meJ = await meR.json();
    if (meJ.success && meJ.data) {
      const b = meJ.data;
      const name = [b.first_name, b.last_name].filter(Boolean).join(' ');
      const un = document.getElementById('portalUserName');
      const co = document.getElementById('portalUserCo');
      if (un) un.textContent = name;
      if (co) co.textContent = b.company || '';
    }

    const pr = await window.builderAuth.fetch('/api/builder-projects');
    const pj = await pr.json();
    if (!pr.ok || !pj.success) {
      host.innerHTML = `<p class="bp-card" style="border-color:#fecaca;color:#b91c1c">${escapeHtml(pj.error || 'Could not load projects')}</p>`;
      return;
    }
    allProjects = pj.data || [];
    renderList();
  }

  load().catch((e) => {
    host.innerHTML = `<p class="bp-card" style="border-color:#fecaca;color:#b91c1c">${escapeHtml(e.message)}</p>`;
  });
})();
