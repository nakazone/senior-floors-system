(function () {
  if (!window.builderAuth.requireAuth()) return;

  const projectId = new URLSearchParams(location.search).get('id');
  const app = document.getElementById('app');
  let state = null;
  let activeTab = 'summary';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      scheduled: ['scheduled', 'Scheduled'],
      in_progress: ['active', 'In progress'],
      active: ['active', 'In progress'],
      completed: ['completed', 'Completed'],
      cancelled: ['cancelled', 'Cancelled'],
    };
    const m = map[s] || ['pending', s || '—'];
    return `<span class="bp-badge bp-badge--${m[0] === 'active' ? 'active' : m[0] === 'completed' ? 'inactive' : 'pending'}">${escapeHtml(m[1])}</span>`;
  }

  function fmtDate(d) {
    if (!d) return '—';
    return String(d).slice(0, 10);
  }

  function renderTimeline(timeline) {
    return `<div class="bp-timeline">${(timeline || [])
      .map(
        (s) =>
          `<div class="bp-timeline__step bp-timeline__step--${s.status}">
            <div class="bp-timeline__dot"></div>
            <span class="bp-timeline__label">${escapeHtml(s.label)}</span>
          </div>`
      )
      .join('')}</div>`;
  }

  function renderPhotos(photos) {
    const byPhase = { before: [], during: [], after: [] };
    (photos || []).forEach((p) => {
      const phase = ['before', 'during', 'after'].includes(p.phase) ? p.phase : 'during';
      byPhase[phase].push(p);
    });
    const phaseLabel = { before: 'Before', during: 'During', after: 'After' };
    return Object.keys(byPhase)
      .map((phase) => {
        const items = byPhase[phase];
        const grid = items.length
          ? items
              .map(
                (p) =>
                  `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" class="bp-photo-card">
                    <img src="${escapeHtml(p.url)}" alt="" loading="lazy" />
                    ${p.partner_label ? '<span class="bp-photo-card__tag">Partner</span>' : ''}
                  </a>`
              )
              .join('')
          : '<p class="bp-muted">No photos yet.</p>';
        return `<section class="bp-photo-section"><h3>${phaseLabel[phase]}</h3><div class="bp-photo-grid">${grid}</div></section>`;
      })
      .join('');
  }

  function renderChecklist(items) {
    if (!items || !items.length) {
      return '<p class="bp-card">No checklist items visible for partners yet. Senior Floors will enable items when ready.</p>';
    }
    return `<div class="bp-checklist">${items
      .map((it) => {
        const checked = it.checked === 1 || it.checked === true;
        const isBuilder = String(it.assigned_to || 'sf').toLowerCase() === 'builder';
        const canToggle = isBuilder;
        return `<div class="bp-check-item ${checked ? 'bp-check-item--done' : ''}">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:${canToggle ? 'pointer' : 'default'}">
            <input type="checkbox" data-chk-id="${it.id}" ${checked ? 'checked' : ''} ${canToggle ? '' : 'disabled'} />
            <span>
              <strong>${escapeHtml(it.item)}</strong>
              <span class="bp-muted" style="display:block;font-size:11px">${escapeHtml(it.category || '')} · ${isBuilder ? 'Your action' : 'Senior Floors'}</span>
            </span>
          </label>
        </div>`;
      })
      .join('')}</div>`;
  }

  function render() {
    const { project: p, timeline, checklist, photos, manager } = state;
    const pct = Math.min(100, Number(p.completion_percentage) || 0);
    app.innerHTML = `
      <a href="builder-portal.html" style="font-size:13px;color:var(--bp-muted);text-decoration:none">? Back to projects</a>
      <header class="bp-proj-header">
        <div>
          <h1 class="bp-title">${escapeHtml(p.name || p.project_number || 'Project')}</h1>
          <p class="bp-muted">${escapeHtml(p.address || '')}</p>
        </div>
        ${statusBadge(p.status)}
      </header>
      <p class="bp-muted" style="margin:0 0 12px">${fmtDate(p.start_date)} ? ${fmtDate(p.end_date_estimated)}</p>
      ${
        manager
          ? `<div class="bp-card bp-manager">
          <strong>Senior Floors contact</strong>
          <p style="margin:4px 0 0">${escapeHtml(manager.name || '')}</p>
          <p class="bp-muted" style="margin:0">${escapeHtml(manager.phone || manager.email || '')}</p>
        </div>`
          : ''
      }
      <div class="bp-progress-wrap">
        <div class="bp-progress-bar"><div class="bp-progress-fill" style="width:${pct}%"></div></div>
        <span class="bp-progress-pct">${pct}%</span>
      </div>
      ${renderTimeline(timeline)}
      <nav class="bp-tabs" role="tablist">
        <button type="button" data-tab="summary" class="${activeTab === 'summary' ? 'active' : ''}">Summary</button>
        <button type="button" data-tab="photos" class="${activeTab === 'photos' ? 'active' : ''}">Site photos</button>
        <button type="button" data-tab="checklist" class="${activeTab === 'checklist' ? 'active' : ''}">Checklist</button>
        <button type="button" data-tab="messages" class="${activeTab === 'messages' ? 'active' : ''}">Messages</button>
      </nav>
      <div id="tabPanel"></div>`;

    const panel = document.getElementById('tabPanel');
    if (activeTab === 'summary') {
      panel.innerHTML = `
        <div class="bp-card">
          <p><strong>Floor type:</strong> ${escapeHtml(p.flooring_type || '—')}</p>
          <p><strong>Area:</strong> ${p.total_sqft ? p.total_sqft + ' sq ft' : '—'}</p>
          <p><strong>Service:</strong> ${escapeHtml(p.service_type || '—')}</p>
          ${
            p.client_notes
              ? `<p><strong>Notes:</strong><br>${escapeHtml(p.client_notes)}</p>`
              : ''
          }
        </div>`;
    } else if (activeTab === 'photos') {
      panel.innerHTML = `
        <div class="bp-card">
          <h3 style="margin:0 0 12px;font-size:1rem">Upload photos</h3>
          <div class="bp-upload-row">
            <select id="uploadPhase"><option value="before">Before</option><option value="during" selected>During</option><option value="after">After</option></select>
            <input type="file" id="uploadFiles" accept="image/*" multiple />
            <button type="button" class="bp-btn-tan" id="btnUpload">Upload</button>
          </div>
          <p id="uploadStatus" class="bp-muted" style="min-height:1.2em"></p>
        </div>
        ${renderPhotos(photos)}`;
      document.getElementById('btnUpload')?.addEventListener('click', uploadPhotos);
    } else if (activeTab === 'checklist') {
      panel.innerHTML = renderChecklist(checklist);
      panel.querySelectorAll('[data-chk-id]').forEach((inp) => {
        inp.addEventListener('change', () => toggleChecklist(inp.dataset.chkId, inp.checked));
      });
    } else {
      panel.innerHTML =
        '<div class="bp-card"><p>Project messages — coming in Sprint 3. Use general Messages for now.</p><a href="builder-messages.html" class="bp-btn-tan" style="display:inline-block;text-decoration:none;margin-top:8px">Open Messages</a></div>';
    }

    app.querySelectorAll('.bp-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        render();
      });
    });
  }

  async function load() {
    const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}`);
    const j = await r.json();
    if (!j.success) {
      app.innerHTML = `<p class="bp-card">${escapeHtml(j.error || 'Project not found')}</p>`;
      return;
    }
    state = j.data;
    render();
  }

  async function uploadPhotos() {
    const files = document.getElementById('uploadFiles')?.files;
    const phase = document.getElementById('uploadPhase')?.value || 'during';
    const status = document.getElementById('uploadStatus');
    if (!files || !files.length) {
      status.textContent = 'Select at least one image.';
      return;
    }
    status.textContent = 'Uploading…';
    let ok = 0;
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('phase', phase);
      const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}/photos`, {
        method: 'POST',
        body: fd,
      });
      if (r.ok) ok++;
    }
    status.textContent = `Uploaded ${ok} of ${files.length} photo(s).`;
    await load();
    activeTab = 'photos';
    render();
  }

  async function toggleChecklist(itemId, checked) {
    const r = await window.builderAuth.fetch(
      `/api/builder-projects/${projectId}/checklist/${itemId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked }),
      }
    );
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || 'Could not update');
      await load();
      return;
    }
    await load();
    activeTab = 'checklist';
    render();
  }

  if (!projectId) {
    app.textContent = 'Invalid project';
    return;
  }
  load();
})();
