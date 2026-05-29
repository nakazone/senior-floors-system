(function () {
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
    return `<span class="bp-badge bp-badge--${m[0]}">${escapeHtml(m[1])}</span>`;
  }

  function renderTimeline(timeline) {
    return `<div class="bp-timeline bp-timeline--dated">${(timeline || [])
      .map((s) => {
        const dates = [
          s.date_actual ? `Done: ${fmtDate(s.date_actual)}` : null,
          s.date_planned ? `Est: ${fmtDate(s.date_planned)}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return `<div class="bp-timeline__step bp-timeline__step--${s.status}">
            <div class="bp-timeline__dot"></div>
            <span class="bp-timeline__label">${escapeHtml(s.label)}</span>
            ${dates ? `<span class="bp-timeline__dates">${escapeHtml(dates)}</span>` : ''}
          </div>`;
      })
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
                  `<div class="bp-photo-card-wrap">
                    <button type="button" class="bp-photo-card" data-photo-url="${escapeHtml(p.url)}" data-photo-id="${p.id}" data-partner="${p.partner_upload ? '1' : '0'}">
                      <img src="${escapeHtml(p.url)}" alt="" loading="lazy" />
                      ${p.partner_label ? '<span class="bp-photo-card__tag">You</span>' : '<span class="bp-photo-card__tag">SF</span>'}
                    </button>
                    ${p.partner_upload ? `<button type="button" class="bp-photo-del" data-photo-id="${p.id}" title="Remove">—</button>` : ''}
                  </div>`
              )
              .join('')
          : '<p class="bp-muted">No photos yet.</p>';
        return `<section class="bp-photo-section"><h3>${phaseLabel[phase]} (${items.length})</h3><div class="bp-photo-grid">${grid}</div></section>`;
      })
      .join('');
  }

  function renderChecklist(groups, progress) {
    const builder = groups?.builder || [];
    const sf = groups?.sf || [];
    const awaiting = groups?.awaiting || [];
    if (!builder.length && !sf.length && !awaiting.length) {
      return '<p class="bp-card">No checklist items visible yet. Senior Floors will enable items when ready.</p>';
    }
    const prog =
      progress && progress.total
        ? `<p class="bp-muted" style="margin-bottom:12px"><strong>${progress.done}</strong> of <strong>${progress.total}</strong> your items completed</p>`
        : '';
    const block = (title, items, canToggle) =>
      items.length
        ? `<h3 style="font-size:13px;margin:16px 0 8px">${title}</h3>
        <div class="bp-checklist">${items
          .map((it) => {
            const checked = it.checked === 1 || it.checked === true;
            return `<div class="bp-check-item ${checked ? 'bp-check-item--done' : ''}">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:${canToggle ? 'pointer' : 'default'}">
            <input type="checkbox" data-chk-id="${it.id}" ${checked ? 'checked' : ''} ${canToggle ? '' : 'disabled'} />
            <span><strong>${escapeHtml(it.item)}</strong>
              <span class="bp-muted" style="display:block;font-size:11px">${escapeHtml(it.category || '')}${it.notes ? ' — ' + escapeHtml(it.notes) : ''}</span>
            </span>
          </label>
        </div>`;
          })
          .join('')}</div>`
        : '';
    return `${prog}${block('Your action items', builder, true)}${block('Awaiting Senior Floors approval', awaiting, false)}${block('Senior Floors', sf, false)}`;
  }

  async function loadProjectMessages(panel) {
    panel.innerHTML = '<p class="bp-muted">Loading messages...</p>';
    const r = await window.builderAuth.fetch(
      `/api/builder-messages/partner/thread?project_id=${projectId}`
    );
    const j = await r.json();
    if (!j.success) {
      panel.innerHTML = '<p>Could not load messages.</p>';
      return;
    }
    const host = document.createElement('div');
    host.className = 'bp-msg-thread';
    host.style.minHeight = '320px';
    panel.innerHTML = '';
    panel.appendChild(host);
    let html = '<div class="bp-msg-scroll" id="projMsgScroll" style="max-height:360px">';
    (j.data.messages || []).forEach((m) => {
      const mine = m.sender_type === 'builder';
      html += `<div class="bp-msg-bubble ${mine ? 'bp-msg-bubble--mine' : ''}"><p>${escapeHtml(m.message)}</p>
        <span class="bp-msg-time">${escapeHtml(String(m.created_at).slice(0, 16))}</span></div>`;
    });
    if (!(j.data.messages || []).length) html += '<p class="bp-muted">No messages for this project yet.</p>';
    html += '</div><footer class="bp-msg-compose"><textarea id="projMsgInput" rows="2" placeholder="Message about this project..."></textarea>
      <button type="button" class="bp-btn-tan" id="projMsgSend">Send</button></footer>';
    host.innerHTML = html;
    const scroll = document.getElementById('projMsgScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    document.getElementById('projMsgSend')?.addEventListener('click', async () => {
      const text = document.getElementById('projMsgInput')?.value?.trim();
      if (!text) return;
      await window.builderAuth.fetch('/api/builder-messages/partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, project_id: parseInt(projectId, 10) }),
      });
      loadProjectMessages(panel);
    });
  }

  function openIssueModal() {
    const modal = document.createElement('div');
    modal.className = 'bp-modal open';
    modal.innerHTML = `<div class="bp-modal__box">
      <h3>Report an issue</h3>
      <textarea id="issueText" rows="4" style="width:100%;box-sizing:border-box" placeholder="Describe the issue..."></textarea>
      <label style="font-size:12px;display:block;margin:8px 0">Urgency
        <select id="issueUrgency" style="width:100%;padding:8px;margin-top:4px"><option value="normal">Normal</option><option value="urgent">Urgent</option></select>
      </label>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="bp-btn-tan" id="issueSubmit">Send to Senior Floors</button>
        <button type="button" class="bp-btn-ghost" id="issueCancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#issueCancel')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#issueSubmit')?.addEventListener('click', async () => {
      const text = document.getElementById('issueText')?.value?.trim();
      if (!text) return;
      const urg = document.getElementById('issueUrgency')?.value;
      await window.builderAuth.fetch('/api/builder-messages/partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[${urg === 'urgent' ? 'URGENT' : 'Issue'}] ${text}`,
          project_id: parseInt(projectId, 10),
        }),
      });
      modal.remove();
      activeTab = 'messages';
      render();
    });
  }

  let lightboxUrls = [];
  let lightboxIdx = 0;

  function openLightbox(urls, start) {
    lightboxUrls = urls;
    lightboxIdx = start;
    let lb = document.getElementById('bpPhotoLightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'bpPhotoLightbox';
      lb.className = 'bp-lightbox open';
      lb.innerHTML = '<div class="bp-lightbox__inner" style="max-width:900px;background:#111;color:#fff;text-align:center;position:relative"><button type="button" class="bp-lightbox__close" id="lbClose">&times;</button><button type="button" id="lbPrev" style="position:absolute;left:8px;top:50%">&#' + '9664;</button><img id="lbImg" style="max-width:100%;max-height:70vh" alt="" /><button type="button" id="lbNext" style="position:absolute;right:8px;top:50%">&#' + '9654;</button></div>';
      document.body.appendChild(lb);
      lb.querySelector('#lbClose')?.addEventListener('click', () => lb.remove());
      lb.querySelector('#lbPrev')?.addEventListener('click', () => { lightboxIdx = (lightboxIdx - 1 + lightboxUrls.length) % lightboxUrls.length; lb.querySelector('#lbImg').src = lightboxUrls[lightboxIdx]; });
      lb.querySelector('#lbNext')?.addEventListener('click', () => { lightboxIdx = (lightboxIdx + 1) % lightboxUrls.length; lb.querySelector('#lbImg').src = lightboxUrls[lightboxIdx]; });
      lb.addEventListener('click', (e) => { if (e.target === lb) lb.remove(); });
    } else lb.classList.add('open');
    lb.querySelector('#lbImg').src = lightboxUrls[lightboxIdx];
  }

  function renderMaterials(materials) {
    const rows = materials || [];
    if (!rows.length) return '<div class="bp-card"><p class="bp-muted">No materials shared for this project yet.</p></div>';
    const supplyLabel = { pending: 'Not ordered', ordered: 'Ordered', received: 'Received', partial: 'Partial', returned: 'Returned' };
    const apprLabel = { pending: 'Your review needed', approved: 'Approved', rejected: 'Change requested' };
    const cards = rows.map((m) => {
      const qty = (m.qty_received ?? 0) + ' / ' + (m.qty_ordered ?? 0) + ' ' + (m.unit || '');
      const appr = m.builder_approval_status || 'pending';
      return '<div class="bp-card bp-mat-card"><strong>' + m.product_name + '</strong> <span class="bp-badge">' + (apprLabel[appr]||appr) + '</span><p class="bp-muted">' + qty + '</p><textarea class="bp-mat-comment" data-mid="' + m.id + '" rows="2" style="width:100%"></textarea><button type="button" class="bp-btn-tan bp-mat-approve" data-mid="' + m.id + '">Approve</button> <button type="button" class="bp-btn-ghost bp-mat-reject" data-mid="' + m.id + '">Request change</button></div>';
    }).join('');
    return '<button type="button" class="bp-btn-tan" id="btnApproveAllMat">Approve all</button>' + cards;
  }

  function wireMaterials(panel) {
    panel.querySelector('#btnApproveAllMat')?.addEventListener('click', async () => {
      await window.builderAuth.fetch('/api/builder-projects/' + projectId + '/materials/approve-all', { method: 'POST' });
      await load(); activeTab = 'materials'; render();
    });
    panel.querySelectorAll('.bp-mat-approve').forEach((btn) => btn.addEventListener('click', () => submitMaterial(btn.dataset.mid, 'approved', panel)));
    panel.querySelectorAll('.bp-mat-reject').forEach((btn) => btn.addEventListener('click', () => submitMaterial(btn.dataset.mid, 'rejected', panel)));
  }

  async function submitMaterial(mid, status, panel) {
    const comment = panel.querySelector('.bp-mat-comment[data-mid="' + mid + '"]')?.value || '';
    await window.builderAuth.fetch('/api/builder-projects/' + projectId + '/materials/' + mid, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ builder_approval_status: status, builder_comment: comment }),
    });
    await load(); activeTab = 'materials'; render();
  }

  function render() {
    const { project: p, timeline, checklist, checklist_groups, checklist_progress, photos, materials, manager } = state;
    const pct = Math.min(100, Number(p.completion_percentage) || 0);
    app.innerHTML = `
      <a href="builder-projects.html" class="bp-back-link">\u2190 Back to projects</a>
      <header class="bp-proj-header">
        <div>
          <h1 class="bp-title">${escapeHtml(p.name || p.project_number || 'Project')}</h1>
          <p class="bp-muted">${escapeHtml(p.address || '')}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${statusBadge(p.status)}
          <button type="button" class="bp-btn-ghost" id="btnIssue">Report issue</button>
        </div>
      </header>
      <p class="bp-muted" style="margin:0 0 12px">${fmtDate(p.start_date)} \u2192 ${fmtDate(p.end_date_estimated)}</p>
      ${
        manager
          ? `<div class="bp-card bp-manager">
          <strong>Senior Floors contact</strong>
          <p style="margin:4px 0 0">${escapeHtml(manager.name || '')}</p>
          <p class="bp-muted" style="margin:0">${escapeHtml(manager.email || '')}</p>
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
        <button type="button" data-tab="materials" class="${activeTab === 'materials' ? 'active' : ''}">Materials</button>
        <button type="button" data-tab="checklist" class="${activeTab === 'checklist' ? 'active' : ''}">Checklist</button>
        <button type="button" data-tab="messages" class="${activeTab === 'messages' ? 'active' : ''}">Messages</button>
      </nav>
      <div id="tabPanel"></div>`;

    document.getElementById('btnIssue')?.addEventListener('click', openIssueModal);
    const panel = document.getElementById('tabPanel');
    if (activeTab === 'summary') {
      const docs = state.documents || [];
      const docList = docs.length
        ? `<ul class="bp-doc-list">${docs
            .map(
              (d) =>
                `<li><a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.name)}</a> <span class="bp-muted">${escapeHtml(d.doc_type || '')}</span></li>`
            )
            .join('')}</ul>`
        : '<p class="bp-muted">No project documents shared yet.</p>';
      panel.innerHTML = `
        <div class="bp-summary-grid">
          <div class="bp-card">
            <h3 style="margin:0 0 10px;font-size:14px">Project details</h3>
            <p><strong>Floor:</strong> ${escapeHtml(p.flooring_type || '—')}</p>
            <p><strong>Area:</strong> ${p.total_sqft ? p.total_sqft + ' sq ft' : '—'}</p>
            <p><strong>Service:</strong> ${escapeHtml(p.service_type || '—')}</p>
            <p><strong>Address:</strong> ${escapeHtml(p.address || '—')}</p>
            <p><strong>Start:</strong> ${fmtDate(p.start_date)}</p>
            <p><strong>Est. completion:</strong> ${fmtDate(p.end_date_estimated)}</p>
            ${manager ? `<p><strong>SF contact:</strong> ${escapeHtml(manager.name || '')}</p>` : ''}
          </div>
          <div class="bp-card">
            <h3 style="margin:0 0 10px;font-size:14px">Project documents</h3>
            ${docList}
            <h3 style="margin:16px 0 10px;font-size:14px">Notes from Senior Floors</h3>
            <p>${escapeHtml(p.client_notes || p.internal_notes_for_builder || 'No notes yet.')}</p>
          </div>
        </div>`;
    } else if (activeTab === 'photos') {
      panel.innerHTML = `
        <div class="bp-card">
          <h3 style="margin:0 0 12px;font-size:1rem">Upload photos</h3>
          <div class="bp-dropzone" id="photoDropzone">
            <p>Drag & drop images here or tap to select</p>
            <input type="file" id="uploadFiles" accept="image/*" multiple hidden />
          </div>
          <div class="bp-upload-row" style="margin-top:10px">
            <select id="uploadPhase"><option value="before">Before</option><option value="during" selected>During</option><option value="after">After</option></select>
            <button type="button" class="bp-btn-tan" id="btnUpload">Upload</button>
          </div>
          <p id="uploadStatus" class="bp-muted" style="min-height:1.2em"></p>
        </div>
        ${renderPhotos(photos)}`;
      wirePhotoUpload();
      const urls = [...panel.querySelectorAll('[data-photo-url]')].map((el) => el.dataset.photoUrl);
      panel.querySelectorAll('[data-photo-url]').forEach((btn, idx) => {
        btn.addEventListener('click', () => openLightbox(urls, idx));
      });
      panel.querySelectorAll('.bp-photo-del').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Remove this photo?')) return;
          await window.builderAuth.fetch(
            `/api/builder-projects/${projectId}/photos/${btn.dataset.photoId}`,
            { method: 'DELETE' }
          );
          await load();
          activeTab = 'photos';
          render();
        });
      });
    } else if (activeTab === 'materials') {
      panel.innerHTML = renderMaterials(materials);
      wireMaterials(panel);
    } else if (activeTab === 'checklist') {
      panel.innerHTML = renderChecklist(checklist_groups, checklist_progress);
      panel.querySelectorAll('[data-chk-id]').forEach((inp) => {
        inp.addEventListener('change', () => toggleChecklist(inp.dataset.chkId, inp.checked));
      });
    } else {
      panel.innerHTML = '<div id="projMsgHost"></div>';
      loadProjectMessages(document.getElementById('projMsgHost'));
    }

    app.querySelectorAll('.bp-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        render();
      });
    });
  }

  function wirePhotoUpload() {
    const dz = document.getElementById('photoDropzone');
    const input = document.getElementById('uploadFiles');
    if (!dz || !input) return;
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('bp-dropzone--over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('bp-dropzone--over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('bp-dropzone--over');
      input.files = e.dataTransfer.files;
    });
    document.getElementById('btnUpload')?.addEventListener('click', uploadPhotos);
  }

  async function load() {
    const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}`);
    const j = await r.json();
    if (!j.success) {
      app.innerHTML = `<p class="bp-card">${escapeHtml(j.error || 'Project not found')}</p>`;
      return;
    }
    state = j.data;
    if (!state.checklist_groups) {
      state.checklist_groups = {
        builder: (state.checklist || []).filter((it) => String(it.assigned_to || 'sf').toLowerCase() === 'builder'),
        sf: (state.checklist || []).filter((it) => String(it.assigned_to || 'sf').toLowerCase() !== 'builder'),
      };
    }
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
    status.textContent = 'Uploading...';
    let ok = 0;
    let i = 0;
    for (const file of files) {
      i++;
      status.textContent = `Uploading ${i}/${files.length}...`;
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
    const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}/checklist/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked }),
    });
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
    if (app) app.textContent = 'Invalid project';
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (window.builderAuth?.getToken()) load();
        else location.href = 'builder-login.html';
      }, 100);
    });
  }
})();
