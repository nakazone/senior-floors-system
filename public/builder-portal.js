(function () {
  const COMPLETED = new Set(['completed', 'closed', 'cancelled']);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt$(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
      Number(n) || 0
    );
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return String(d).slice(0, 10);
    }
  }

  async function load() {
    const [dashR, prR] = await Promise.all([
      window.builderAuth.fetch('/api/builder-dashboard'),
      window.builderAuth.fetch('/api/builder-projects'),
    ]);
    const dash = await dashR.json();
    const pj = await prR.json();

    if (dash.success && dash.data) {
      const d = dash.data;
      const m = d.metrics || {};
      document.getElementById('metricActive').textContent = String(m.active_projects ?? 0);
      document.getElementById('metricTotal').textContent = String(m.total_projects ?? 0);
      document.getElementById('metricSqft').textContent = String(Math.round(m.total_sqft_completed || 0));
      document.getElementById('metricValue').textContent = fmt$(m.total_value_completed);
      document.getElementById('metricYear').textContent = String(m.completed_this_year ?? 0);

      try {
        const ur = await window.builderAuth.fetch('/api/builder-notifications/unread-count');
        const uj = await ur.json();
        if (uj.success) document.getElementById('metricUnread').textContent = String(uj.data.total || 0);
      } catch (_) {}

      const u = window.builderPortalUser || {};
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
      document.getElementById('welcomeTitle').textContent = `Hello, ${u.first_name || name || 'Partner'}`;

      if (d.pending_documents > 0) {
        const al = document.getElementById('docAlert');
        al.classList.remove('hidden');
        al.className = 'bp-alert bp-alert--warn';
        al.innerHTML = `<strong>${d.pending_documents} document(s) need attention.</strong> <a href="builder-profile.html#documents">Update documents</a>`;
      }

      if (d.next_visit) {
        const nv = document.getElementById('nextVisitCard');
        nv.classList.remove('hidden');
        nv.className = 'bp-card bp-next-visit';
        nv.innerHTML = `
          <div class="bp-next-visit__label">Next scheduled visit</div>
          <div class="bp-next-visit__date">${fmtDate(d.next_visit.start_date)}</div>
          <p style="margin:6px 0 0"><strong>${escapeHtml(d.next_visit.project_name || '')}</strong></p>
          <p class="bp-muted" style="margin:4px 0 0">${escapeHtml(d.next_visit.address || '')}</p>
          <a href="builder-project.html?id=${d.next_visit.project_id}" class="bp-btn-tan" style="display:inline-block;margin-top:10px;text-decoration:none">View project</a>`;
      }

      const mgr = d.account_manager;
      if (mgr) {
        const mc = document.getElementById('managerCard');
        mc.classList.remove('hidden');
        mc.className = 'bp-card bp-manager-card';
        mc.innerHTML = `
          <strong>Your Senior Floors manager</strong>
          <p style="margin:6px 0 0">${escapeHtml(mgr.name || '')}</p>
          <p class="bp-muted" style="margin:4px 0 0">${escapeHtml(mgr.email || '')}</p>
          <a href="builder-messages.html" class="bp-btn-tan" style="display:inline-block;margin-top:10px;text-decoration:none;font-size:13px">Send message</a>`;
      }

      const feed = document.getElementById('activityFeed');
      const acts = d.activity || [];
      feed.innerHTML = acts.length
        ? acts
            .map(
              (a) => `<div class="bp-activity-item">
            <span class="bp-activity-item__time">${fmtDate(a.created_at)}</span>
            <p>${escapeHtml(a.text)}</p>
            ${a.project_id ? `<a href="builder-project.html?id=${a.project_id}">${escapeHtml(a.project_name || 'Project')}</a>` : ''}
          </div>`
            )
            .join('')
        : '<p class="bp-muted">No recent activity yet.</p>';
    }

    const el = document.getElementById('projectCards');
    if (!prR.ok || !pj.success) {
      el.innerHTML = `<p class="bp-card">${escapeHtml(pj.error || 'Could not load projects')}</p>`;
      return;
    }

    const all = pj.data || [];
    const projects = all.filter((p) => !COMPLETED.has(String(p.status || '').toLowerCase()));

    if (!projects.length) {
      el.innerHTML =
        '<p class="bp-card">No active projects yet. <a href="builder-estimate-request.html">Request an estimate</a>.</p>';
      return;
    }
    el.innerHTML = projects
      .slice(0, 6)
      .map(
        (p) => `<div class="bp-card bp-proj-card">
          <div>
            <strong>${escapeHtml(p.name || p.project_number || 'Project')}</strong>
            <p class="bp-muted" style="margin:4px 0 0">${escapeHtml(p.address || '')}</p>
            <p class="bp-muted" style="font-size:11px;margin:4px 0 0">Start: ${fmtDate(p.start_date)} — ${p.total_sqft ? p.total_sqft + ' sqft' : ''}</p>
            <div class="bp-progress-bar" style="margin-top:8px;max-width:220px"><div class="bp-progress-fill" style="width:${Math.min(100, p.completion_percentage || 0)}%"></div></div>
          </div>
          <a href="builder-project.html?id=${p.id}" class="bp-btn-tan" style="text-decoration:none;align-self:center">Details</a>
        </div>`
      )
      .join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.builderAuth?.getToken()) load().catch(console.error);
    }, 100);
  });
})();
