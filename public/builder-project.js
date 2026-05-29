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
    if (!d) return '-';
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

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(iso).slice(11, 16);
    }
  }

  function fmtDayLabel(iso) {
    if (!iso) return '';
    const day = String(iso).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);
    if (day === today) return 'Today';
    if (day === yesterday) return 'Yesterday';
    return fmtDate(day);
  }

  function teamInitials(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'SF';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarSrc(url) {
    if (!url) return null;
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/')) return u;
    return `/${u.replace(/^\//, '')}`;
  }

  function renderProjectTeam(team) {
    const roles = team && team.length ? team : [];
    const cards = roles
      .map((member) => {
        const src = avatarSrc(member.avatar_url);
        const initials = escapeHtml(teamInitials(member.name));
        const avatar = src
          ? `<img class="bp-team-card__avatar" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.classList.add('hidden');this.nextElementSibling?.classList.remove('hidden');" /><div class="bp-team-card__avatar bp-team-card__avatar--init hidden">${initials}</div>`
          : `<div class="bp-team-card__avatar bp-team-card__avatar--init">${initials}</div>`;
        const phone = member.phone ? String(member.phone).trim() : '';
        const tel = phone ? phone.replace(/[^\d+]/g, '') : '';
        const contact = member.name
          ? `<p class="bp-team-card__name">${escapeHtml(member.name)}</p>
            ${phone ? `<p class="bp-team-card__contact"><a href="tel:${escapeHtml(tel)}">${escapeHtml(phone)}</a></p>` : ''}
            ${member.email ? `<p class="bp-team-card__contact"><a href="mailto:${escapeHtml(member.email)}">${escapeHtml(member.email)}</a></p>` : ''}`
          : `<p class="bp-team-card__empty">To be assigned by Senior Floors</p>`;
        return `<article class="bp-team-card">
          <div class="bp-team-card__avatar-wrap">
            ${avatar}
            <span class="bp-team-card__badge" title="Senior Floors"><img src="/assets/SeniorFloors.png" alt="Senior Floors" /></span>
          </div>
          <h3 class="bp-team-card__role">${escapeHtml(member.title)}</h3>
          ${contact}
        </article>`;
      })
      .join('');
    return `<section class="bp-proj-team" aria-label="Senior Floors project team">
      <h2 class="bp-proj-team__title">Your Senior Floors team</h2>
      <div class="bp-proj-team__grid">${cards}</div>
    </section>`;
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
    const m = map[s] || ['pending', s || '-'];
    return `<span class="bp-badge bp-badge--${m[0]}">${escapeHtml(m[1])}</span>`;
  }

  function renderTimeline(timeline) {
    return `<div class="bp-timeline bp-timeline--dated">${(timeline || [])
      .map((s) => {
        const statusClass = s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : 'pending';
        let dates = '';
        if (s.status === 'done' && s.date_actual) {
          dates = `<span class="bp-timeline__actual">Done ${fmtDate(s.date_actual)}</span>`;
        } else if (s.date_planned) {
          dates = `<span class="bp-timeline__planned">Est. ${fmtDate(s.date_planned)}</span>`;
        }
        return `<div class="bp-timeline__step bp-timeline__step--${statusClass}">
            <div class="bp-timeline__dot"></div>
            <span class="bp-timeline__label">${escapeHtml(s.label)}</span>
            ${dates ? `<span class="bp-timeline__dates">${dates}</span>` : ''}
          </div>`;
      })
      .join('')}</div>`;
  }

  function photoMeta(p) {
    const when = p.created_at ? fmtDate(p.created_at) : '';
    const phase = p.phase ? String(p.phase).charAt(0).toUpperCase() + String(p.phase).slice(1) : '';
    return [when, phase].filter(Boolean).join(' | ');
  }

  function renderPhotos(photos) {
    const list = photos || [];
    if (!list.length) {
      return `<div class="bp-card bp-photos-empty">
        <p><strong>No site photos yet</strong></p>
        <p class="bp-muted">Senior Floors will publish project photos here after they are added in our system. Check back after your next site visit is documented.</p>
      </div>`;
    }
    const byPhase = { before: [], during: [], after: [] };
    list.forEach((p) => {
      const phase = ['before', 'during', 'after'].includes(p.phase) ? p.phase : 'during';
      byPhase[phase].push(p);
    });
    const phaseLabel = { before: 'Before', during: 'During', after: 'After' };
    const allPhotos = list;
    return Object.keys(byPhase)
      .map((phase) => {
        const items = byPhase[phase];
        const grid = items.length
          ? items
              .map((p, idx) => {
                const globalIdx = allPhotos.findIndex((x) => x.id === p.id);
                return `<div class="bp-photo-card-wrap">
                    <button type="button" class="bp-photo-card" data-photo-idx="${globalIdx >= 0 ? globalIdx : idx}">
                      <img src="${escapeHtml(p.url)}" alt="" loading="lazy" />
                      <span class="bp-photo-card__tag">SF</span>
                    </button>
                    <div class="bp-photo-card__meta">${escapeHtml(photoMeta(p))}</div>
                  </div>`;
              })
              .join('')
          : '<p class="bp-muted">No photos yet.</p>';
        return `<section class="bp-photo-section"><h3>${phaseLabel[phase]} (${items.length})</h3><div class="bp-photo-grid">${grid}</div></section>`;
      })
      .join('');
  }

  function responsibleLabel(assigned) {
    const a = String(assigned || 'sf').toLowerCase();
    return a === 'builder' ? 'Builder' : 'Senior Floors';
  }

  function renderChecklist(groups, progress) {
    const builder = groups?.builder || [];
    const sf = groups?.sf || [];
    const awaiting = groups?.awaiting || [];
    if (!builder.length && !sf.length && !awaiting.length) {
      return `<div class="bp-card bp-checklist-empty">
        <p><strong>Checklist not ready yet</strong></p>
        <p class="bp-muted">Senior Floors will enable items when your project is scheduled. When available, you will see:</p>
        <ul>
          <li>Your action items (with checkboxes)</li>
          <li>Items awaiting SF approval</li>
          <li>Senior Floors responsibilities</li>
        </ul>
        <p class="bp-muted" style="margin-top:12px">You will receive an email when new items are assigned to you.</p>
      </div>`;
    }
    const prog =
      progress && progress.total
        ? `<p class="bp-muted" style="margin-bottom:12px"><strong>${progress.done}</strong> of <strong>${progress.total}</strong> your items completed</p>`
        : '';
    const renderItem = (it, canToggle) => {
      const checked = it.checked === 1 || it.checked === true;
      const due = it.due_date ? `<span class="bp-muted"> - Due ${fmtDate(it.due_date)}</span>` : '';
      const resp = `<span class="bp-muted" style="display:block;font-size:11px">Responsible: ${responsibleLabel(it.assigned_to)}${due}</span>`;
      const notes = it.notes ? `<span class="bp-muted" style="display:block;font-size:11px">${escapeHtml(it.notes)}</span>` : '';
      return `<div class="bp-check-item ${checked ? 'bp-check-item--done' : ''}">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:${canToggle ? 'pointer' : 'default'}">
            <input type="checkbox" data-chk-id="${it.id}" ${checked ? 'checked' : ''} ${canToggle ? '' : 'disabled'} />
            <span><strong>${escapeHtml(it.item)}</strong>
              ${it.category ? `<span class="bp-muted" style="display:block;font-size:11px">${escapeHtml(it.category)}</span>` : ''}
              ${resp}${notes}
            </span>
          </label>
        </div>`;
    };
    const block = (title, items, canToggle) =>
      items.length
        ? `<h3 style="font-size:13px;margin:16px 0 8px">${title}</h3><div class="bp-checklist">${items.map((it) => renderItem(it, canToggle)).join('')}</div>`
        : '';
    return `${prog}${block('Your responsibility', builder, true)}${block('Awaiting approval', awaiting, false)}${block('Senior Floors responsibility', sf, false)}`;
  }

  function openLightbox(photos, index) {
    let curr = Math.max(0, Math.min(index, photos.length - 1));
    const overlay = document.createElement('div');
    overlay.className = 'bp-proj-lightbox open';
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML = `<div style="text-align:center;max-width:95vw">
      <img class="bp-proj-lightbox__img" alt="" />
      <p class="bp-proj-lightbox__cap"></p>
      <div class="bp-proj-lightbox__nav"></div>
    </div>`;
    const img = overlay.querySelector('.bp-proj-lightbox__img');
    const cap = overlay.querySelector('.bp-proj-lightbox__cap');
    const nav = overlay.querySelector('.bp-proj-lightbox__nav');

    function draw() {
      const p = photos[curr];
      if (!p) return;
      img.src = p.url;
      cap.textContent = `${photoMeta(p)} - ${curr + 1} / ${photos.length}`;
      nav.innerHTML = '';
      if (curr > 0) {
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'bp-proj-lightbox__btn';
        prev.textContent = '? Previous';
        prev.onclick = () => {
          curr--;
          draw();
        };
        nav.appendChild(prev);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'bp-proj-lightbox__btn';
      close.textContent = 'Close';
      close.onclick = () => overlay.remove();
      nav.appendChild(close);
      if (curr < photos.length - 1) {
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'bp-proj-lightbox__btn';
        next.textContent = 'Next ?';
        next.onclick = () => {
          curr++;
          draw();
        };
        nav.appendChild(next);
      }
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.addEventListener(
      'keydown',
      function onKey(e) {
        if (!document.body.contains(overlay)) {
          document.removeEventListener('keydown', onKey);
          return;
        }
        if (e.key === 'Escape') overlay.remove();
        if (e.key === 'ArrowLeft' && curr > 0) {
          curr--;
          draw();
        }
        if (e.key === 'ArrowRight' && curr < photos.length - 1) {
          curr++;
          draw();
        }
      },
      { passive: true }
    );
    document.body.appendChild(overlay);
    draw();
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
    const messages = j.data.messages || [];
    let html = '<div class="bp-msg-thread"><div class="bp-msg-scroll" id="projMsgScroll" style="max-height:400px">';
    let lastDate = '';
    messages.forEach((m) => {
      const day = String(m.created_at).slice(0, 10);
      if (day !== lastDate) {
        lastDate = day;
        html += `<div class="bp-msg-date">${escapeHtml(fmtDayLabel(m.created_at))}</div>`;
      }
      const mine = m.sender_type === 'builder';
      const sender = mine ? 'You' : 'Senior Floors';
      const att =
        m.attachment_url && !m.is_internal_note
          ? m.attachment_url.match(/\.pdf$/i)
            ? `<p><a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener">PDF attachment</a></p>`
            : `<p><a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(m.attachment_url)}" alt="" style="max-width:220px;border-radius:8px;margin-top:6px" loading="lazy" /></a></p>`
          : '';
      const readMark = mine && m.is_read ? ' <span title="Read">??</span>' : mine ? ' <span title="Sent">?</span>' : '';
      html += `<div class="bp-msg-bubble ${mine ? 'bp-msg-bubble--mine' : ''}">
        <span class="bp-msg-sender" style="font-size:10px;font-weight:600;opacity:.85">${escapeHtml(sender)}</span>
        <p>${escapeHtml(m.message)}</p>${att}
        <span class="bp-msg-time">${fmtTime(m.created_at)}${readMark}</span>
      </div>`;
    });
    if (!messages.length) {
      html += '<p class="bp-muted" style="text-align:center;padding:24px">No messages yet. Contact your Senior Floors manager below.</p>';
    }
    html += `</div><footer class="bp-msg-compose">
      <textarea id="projMsgInput" rows="2" placeholder="Message about this project..."></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <label class="bp-btn-ghost" style="cursor:pointer;font-size:12px;padding:6px 10px">Attach
          <input type="file" id="projMsgAttach" accept=".jpg,.jpeg,.png,.webp,.pdf" hidden />
        </label>
        <button type="button" class="bp-btn-tan" id="projMsgSend">Send</button>
      </div>
    </footer></div>`;
    panel.innerHTML = html;
    const scroll = document.getElementById('projMsgScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    document.getElementById('projMsgSend')?.addEventListener('click', () => sendProjectMessage(panel));
  }

  async function sendProjectMessage(panel) {
    const text = document.getElementById('projMsgInput')?.value?.trim();
    const file = document.getElementById('projMsgAttach')?.files?.[0];
    if (!text && !file) return;
    const fd = new FormData();
    if (text) fd.append('message', text);
    else if (file) fd.append('message', '(attachment)');
    if (file) fd.append('attachment', file);
    fd.append('project_id', String(parseInt(projectId, 10)));
    const r = await window.builderAuth.fetch('/api/builder-messages/partner', { method: 'POST', body: fd });
    if (!r.ok) {
      alert('Could not send message');
      return;
    }
    document.getElementById('projMsgInput').value = '';
    const att = document.getElementById('projMsgAttach');
    if (att) att.value = '';
    loadProjectMessages(panel);
  }

  function openMessageModal(title, placeholder, prefix) {
    const modal = document.createElement('div');
    modal.className = 'bp-modal open';
    modal.innerHTML = `<div class="bp-modal__box">
      <h3>${escapeHtml(title)}</h3>
      <textarea id="quickMsgText" rows="4" style="width:100%;box-sizing:border-box" placeholder="${escapeHtml(placeholder)}"></textarea>
      <label style="font-size:12px;display:block;margin:8px 0">Urgency
        <select id="quickMsgUrgency" style="width:100%;padding:8px;margin-top:4px">
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button type="button" class="bp-btn-tan" id="quickMsgSubmit">Send</button>
        <button type="button" class="bp-btn-ghost" id="quickMsgCancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#quickMsgCancel')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#quickMsgSubmit')?.addEventListener('click', async () => {
      const text = document.getElementById('quickMsgText')?.value?.trim();
      if (!text) return;
      const urg = document.getElementById('quickMsgUrgency')?.value;
      const tag = urg === 'urgent' ? 'URGENT' : prefix;
      await window.builderAuth.fetch('/api/builder-messages/partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[${tag}] ${text}`,
          project_id: parseInt(projectId, 10),
        }),
      });
      modal.remove();
      activeTab = 'messages';
      render();
    });
  }

  function renderMaterials(materials) {
    const rows = materials || [];
    if (!rows.length) {
      return '<div class="bp-card"><p class="bp-muted">No materials shared for this project yet. Senior Floors will update when orders are placed.</p></div>';
    }
    const statusLabel = {
      pending: 'Pending',
      ordered: 'Ordered',
      received: 'Received',
      partial: 'Partial',
      returned: 'Returned',
    };
    const approvalLabel = { pending: 'Awaiting your approval', approved: 'Approved', rejected: 'Rejected' };
    return `<div class="bp-table-wrap"><table class="bp-table bp-materials-table"><thead><tr>
      <th>Product</th><th>SKU</th><th>Qty</th><th>Status</th><th>Dates</th><th></th>
    </tr></thead><tbody>${rows
      .map((m) => {
        const qty = `${m.qty_received ?? 0} / ${m.qty_ordered ?? 0} ${escapeHtml(m.unit || '')}`.trim();
        const dates = [
          m.order_date ? `Ordered ${fmtDate(m.order_date)}` : null,
          m.received_date ? `Received ${fmtDate(m.received_date)}` : null,
        ]
          .filter(Boolean)
          .join(' - ');
        const appr = m.builder_approval_status
          ? `<span class="bp-muted" style="display:block;font-size:11px">${approvalLabel[m.builder_approval_status] || m.builder_approval_status}</span>`
          : '';
        const actions =
          m.builder_approval_status === 'pending'
            ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                <button type="button" class="bp-btn-tan bp-mat-approve" data-mid="${m.id}" style="font-size:11px;padding:4px 8px">Approve</button>
                <button type="button" class="bp-btn-ghost bp-mat-reject" data-mid="${m.id}" style="font-size:11px;padding:4px 8px">Reject</button>
              </div>`
            : '';
        return `<tr data-mat-id="${m.id}">
          <td data-label="Product"><strong>${escapeHtml(m.product_name)}</strong>
            ${m.supplier ? `<span class="bp-muted" style="display:block;font-size:11px">${escapeHtml(m.supplier)}</span>` : ''}${appr}</td>
          <td data-label="SKU">${escapeHtml(m.sku || '-')}</td>
          <td data-label="Qty">${escapeHtml(qty)}</td>
          <td data-label="Status"><span class="bp-badge bp-badge--pending">${escapeHtml(statusLabel[m.status] || m.status || '-')}</span></td>
          <td data-label="Dates" style="font-size:12px">${escapeHtml(dates || '-')}</td>
          <td data-label="">${actions}</td>
        </tr>`;
      })
      .join('')}</tbody></table></div>`;
  }

  function wireMaterials(panel) {
    panel.querySelectorAll('.bp-mat-approve').forEach((btn) => {
      btn.addEventListener('click', () => updateMaterial(btn.dataset.mid, 'approved'));
    });
    panel.querySelectorAll('.bp-mat-reject').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const comment = prompt('Optional comment for rejection:') || '';
        updateMaterial(btn.dataset.mid, 'rejected', comment);
      });
    });
  }

  async function updateMaterial(materialId, status, comment) {
    const r = await window.builderAuth.fetch(
      `/api/builder-projects/${projectId}/materials/${materialId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ builder_approval_status: status, builder_comment: comment || null }),
      }
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || 'Could not update material');
      return;
    }
    await load();
    activeTab = 'materials';
    render();
  }

  function render() {
    if (!state?.project) return;
    const { project: p, timeline, checklist_groups, checklist_progress, photos, materials, project_team } =
      state;
    const pct = Math.min(100, Number(p.completion_percentage) || 0);
    app.innerHTML = `
      <a href="builder-projects.html" class="bp-back-link">&larr; Back to projects</a>
      <header class="bp-proj-header">
        <div>
          <h1 class="bp-title">${escapeHtml(p.name || p.project_number || 'Project')}</h1>
          <p class="bp-muted">${escapeHtml(p.address || '')}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${statusBadge(p.status)}
          <button type="button" class="bp-btn-ghost" id="btnContact">Contact SF</button>
          <button type="button" class="bp-btn-ghost" id="btnIssue">Report issue</button>
        </div>
      </header>
      <p class="bp-muted" style="margin:0 0 12px">${fmtDate(p.start_date)} &rarr; ${fmtDate(p.end_date_estimated)}</p>
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
      <div id="tabPanel"></div>
      ${renderProjectTeam(project_team)}`;

    document.getElementById('btnIssue')?.addEventListener('click', () =>
      openMessageModal('Report an issue', 'Describe the issue or site problem...', 'Issue')
    );
    document.getElementById('btnContact')?.addEventListener('click', () =>
      openMessageModal(
        'Contact Senior Floors',
        'Your question or request about this project...',
        'Contact'
      )
    );

    const panel = document.getElementById('tabPanel');
    if (activeTab === 'summary') {
      const docs = state.documents || [];
      const docList = docs.length
        ? `<ul class="bp-doc-list">${docs
            .map(
              (d) =>
                `<li><a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" download>${escapeHtml(d.name)}</a> <span class="bp-muted">${escapeHtml(d.doc_type || '')}</span></li>`
            )
            .join('')}</ul>`
        : '<p class="bp-muted">No project documents shared yet.</p>';
      const sfNotes = p.internal_notes_for_builder || '';
      const clientNotes = p.client_notes && p.client_notes !== sfNotes ? p.client_notes : '';
      panel.innerHTML = `
        <div class="bp-summary-grid">
          <div class="bp-card">
            <h3 style="margin:0 0 10px;font-size:14px">Project details</h3>
            <p><strong>Floor:</strong> ${escapeHtml(p.flooring_type || '-')}</p>
            <p><strong>Area:</strong> ${p.total_sqft ? `${p.total_sqft} sq ft` : '-'}</p>
            <p><strong>Service:</strong> ${escapeHtml(p.service_type || '-')}</p>
            <p><strong>Address:</strong> ${escapeHtml(p.address || '-')}</p>
            <p><strong>Start:</strong> ${fmtDate(p.start_date)}</p>
            <p><strong>Est. completion:</strong> ${fmtDate(p.end_date_estimated)}</p>
          </div>
          <div class="bp-card">
            <h3 style="margin:0 0 10px;font-size:14px">Project documents</h3>
            ${docList}
            <h3 style="margin:16px 0 10px;font-size:14px">Notes from Senior Floors</h3>
            <p style="white-space:pre-wrap">${escapeHtml(sfNotes || 'No notes yet.')}</p>
            ${clientNotes ? `<h3 style="margin:16px 0 10px;font-size:14px">Project notes</h3><p style="white-space:pre-wrap">${escapeHtml(clientNotes)}</p>` : ''}
          </div>
        </div>`;
    } else if (activeTab === 'photos') {
      const photoList = photos || [];
      panel.innerHTML = `
        <div class="bp-card" style="margin-bottom:16px">
          <h3 style="margin:0 0 8px;font-size:1rem">Site photos</h3>
          <p class="bp-muted" style="margin:0;font-size:13px">Photos added by Senior Floors for this project. Tap any image to view full size.</p>
        </div>
        ${renderPhotos(photoList)}`;
      panel.querySelectorAll('[data-photo-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.photoIdx, 10);
          openLightbox(photoList, idx);
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


  async function load() {
    try {
      const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}`);
      let j;
      try {
        j = await r.json();
      } catch (_) {
        app.innerHTML = `<p class="bp-card">Could not load project (invalid server response).</p>`;
        return;
      }
      if (!r.ok || !j.success) {
        app.innerHTML = `<p class="bp-card">${escapeHtml(j.error || 'Project not found')}</p>
          <p style="margin-top:12px"><a href="builder-projects.html">Back to projects</a></p>`;
        return;
      }
      if (!j.data?.project) {
        app.innerHTML = `<p class="bp-card">Project data is incomplete. Please try again or contact Senior Floors.</p>`;
        return;
      }
      state = j.data;
      if (!state.project_team || !state.project_team.length) {
        const gm = state.manager;
        state.project_team = [
          {
            role: 'general_manager',
            title: 'General Manager',
            name: gm?.name,
            email: gm?.email,
            phone: gm?.phone,
            avatar_url: gm?.avatar_url,
          },
          { role: 'installation_supervisor', title: 'Installation Supervisor' },
          { role: 'sand_finish_supervisor', title: 'Sand & Finish Supervisor' },
        ];
      }
      if (!state.checklist_groups) {
        state.checklist_groups = {
          builder: (state.checklist || []).filter(
            (it) =>
              String(it.assigned_to || 'sf').toLowerCase() === 'builder' &&
              String(it.approval_status || '') !== 'pending_sf'
          ),
          sf: (state.checklist || []).filter(
            (it) =>
              String(it.assigned_to || 'sf').toLowerCase() !== 'builder' &&
              String(it.approval_status || '') !== 'pending_sf'
          ),
          awaiting: (state.checklist || []).filter((it) => String(it.approval_status || '') === 'pending_sf'),
        };
      }
      render();
    } catch (err) {
      console.error('load project:', err);
      app.innerHTML = `<p class="bp-card">Could not load project. ${escapeHtml(err.message || 'Network error')}</p>
        <p style="margin-top:12px"><a href="builder-projects.html">Back to projects</a></p>`;
    }
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
