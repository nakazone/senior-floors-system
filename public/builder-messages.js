/* global crmNotify */
(function () {
  function isPortal() {
    return !!window.builderAuth?.getToken?.();
  }

  const params = new URLSearchParams(location.search);
  let activeBuilderId = params.get('builder_id') ? parseInt(params.get('builder_id'), 10) : null;
  let pollTimer = null;
  let projectFilter = params.get('project_id') || '';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
    try {
      return new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return day;
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

  function threadUrl() {
    let url = '/api/builder-messages/partner/thread';
    if (projectFilter === 'general') url += '?general=1';
    else if (projectFilter) url += `?project_id=${encodeURIComponent(projectFilter)}`;
    return url;
  }

  function renderMessages(host, messages, opts) {
    const { showInternal = false, builder } = opts;
    let html = '';
    if (builder && !isPortal()) {
      html += `<header class="bp-msg-header"><strong>${escapeHtml(builder.company || [builder.first_name, builder.last_name].filter(Boolean).join(' '))}</strong></header>`;
    }
    html += '<div class="bp-msg-scroll" id="msgScroll">';
    let lastDate = '';
    (messages || []).forEach((m) => {
      const day = String(m.created_at).slice(0, 10);
      if (day !== lastDate) {
        lastDate = day;
        html += `<div class="bp-msg-date">${escapeHtml(fmtDayLabel(m.created_at))}</div>`;
      }
      const mine = isPortal() ? m.sender_type === 'builder' : m.sender_type === 'admin';
      const internal = m.is_internal_note === 1 || m.is_internal_note === true;
      if (internal && !showInternal) return;
      const readMark = mine && m.is_read ? ' <span title="Read">&#10003;&#10003;</span>' : mine ? ' <span title="Sent">&#10003;</span>' : '';
      const att =
        m.attachment_url && !internal
          ? m.attachment_url.match(/\.(pdf)$/i)
            ? `<p><a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener">?? PDF attachment</a></p>`
            : `<p><a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(m.attachment_url)}" alt="" style="max-width:220px;border-radius:8px;margin-top:6px" loading="lazy" /></a></p>`
          : '';
      html += `<div class="bp-msg-bubble ${mine ? 'bp-msg-bubble--mine' : ''} ${internal ? 'bp-msg-bubble--note' : ''}">
        <p>${escapeHtml(m.message)}</p>${att}
        <span class="bp-msg-time">${fmtTime(m.created_at)}${readMark}${internal ? ' (internal)' : ''}</span>
      </div>`;
    });
    if (!(messages || []).length) {
      html += '<p class="bp-muted" style="text-align:center;padding:24px">No messages yet. Say hello to your Senior Floors team.</p>';
    }
    html += '</div>';
    html += `<footer class="bp-msg-compose">
      ${!isPortal() ? '<label style="font-size:11px;display:flex;align-items:center;gap:6px;margin-bottom:6px"><input type="checkbox" id="internalNote" /> Internal note (staff only)</label>' : ''}
      <textarea id="msgInput" rows="2" placeholder="Write a message..."></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
        ${isPortal() ? '<label class="bp-btn-ghost" style="cursor:pointer;font-size:12px;padding:6px 10px">?? <input type="file" id="msgAttach" accept=".jpg,.jpeg,.png,.webp,.pdf" hidden /></label>' : ''}
        <button type="button" class="bp-btn-tan" id="btnSend">Send</button>
      </div>
    </footer>`;
    host.innerHTML = html;
    const scroll = document.getElementById('msgScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    document.getElementById('btnSend')?.addEventListener('click', () => sendMessage(host, opts));
  }

  async function sendMessage(host, opts) {
    const text = document.getElementById('msgInput')?.value?.trim();
    const file = document.getElementById('msgAttach')?.files?.[0];
    if (!text && !file) return;
    if (isPortal() && projectFilter && projectFilter !== 'general') {
      /* project_id set below */
    }
    if (isPortal()) {
      const fd = new FormData();
      if (text) fd.append('message', text);
      else if (file) fd.append('message', '(attachment)');
      if (file) fd.append('attachment', file);
      if (projectFilter && projectFilter !== 'general') {
        fd.append('project_id', String(parseInt(projectFilter, 10)));
      }
      const r = await window.builderAuth.fetch('/api/builder-messages/partner', {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) {
        crmNotify?.('Send failed', 'error') || alert('Send failed');
        return;
      }
      document.getElementById('msgInput').value = '';
      const att = document.getElementById('msgAttach');
      if (att) att.value = '';
      await loadPortalThread(host);
    } else {
      body.builder_id = activeBuilderId;
      body.is_internal_note = !!document.getElementById('internalNote')?.checked;
      const r = await fetch('/api/builder-messages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        crmNotify?.(j.error || 'Error', 'error') || alert(j.error);
        return;
      }
      document.getElementById('msgInput').value = '';
      await loadAdminThread(activeBuilderId);
    }
  }

  async function loadAdminThread(builderId) {
    activeBuilderId = builderId;
    const r = await fetch(`/api/builder-messages/thread/${builderId}?include_internal=1`, {
      credentials: 'include',
    });
    const j = await r.json();
    if (!j.success) return;
    renderMessages(document.getElementById('threadPanel'), j.data.messages, {
      showInternal: true,
      builder: j.data.builder,
    });
    document.querySelectorAll('.bp-msg-conv').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.id, 10) === builderId);
    });
  }

  async function loadAdminList() {
    const r = await fetch('/api/builder-messages/conversations', { credentials: 'include' });
    const j = await r.json();
    const list = document.getElementById('convList');
    const rows = j.data || [];
    if (!rows.length) {
      list.innerHTML = '<p style="padding:12px">No conversations yet.</p>';
      return;
    }
    list.innerHTML = rows
      .map(
        (c) => `<button type="button" class="bp-msg-conv ${c.builder_id === activeBuilderId ? 'active' : ''}" data-id="${c.builder_id}">
          <strong>${escapeHtml(c.company || c.first_name + ' ' + c.last_name)}</strong>
          ${c.unread_count > 0 ? `<span class="bp-badge bp-badge--pending">${c.unread_count}</span>` : ''}
          <p class="bp-muted">${escapeHtml((c.last_message || '').slice(0, 60))}</p>
        </button>`
      )
      .join('');
    list.querySelectorAll('.bp-msg-conv').forEach((btn) => {
      btn.addEventListener('click', () => loadAdminThread(parseInt(btn.dataset.id, 10)));
    });
    if (activeBuilderId) loadAdminThread(activeBuilderId);
  }

  async function loadPortalThread(host) {
    const r = await window.builderAuth.fetch(threadUrl());
    const j = await r.json();
    if (!j.success) {
      host.innerHTML = '<p class="bp-card">Could not load messages.</p>';
      return;
    }
    renderMessages(host, j.data.messages, { builder: j.data.builder });
  }

  async function populateProjectFilter() {
    const sel = document.getElementById('msgProjectFilter');
    if (!sel) return;
    const r = await window.builderAuth.fetch('/api/builder-projects');
    const j = await r.json();
    (j.data || []).forEach((p) => {
      const o = document.createElement('option');
      o.value = String(p.id);
      o.textContent = p.name || p.project_number || `Project #${p.id}`;
      if (String(p.id) === String(projectFilter)) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      projectFilter = sel.value;
      loadPortalThread(document.getElementById('portalThread'));
    });
  }

  function startPolling(host) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => loadPortalThread(host), 30000);
  }

  async function init() {
    if (isPortal()) {
      document.getElementById('adminShell')?.classList.add('hidden');
      document.getElementById('portalShell')?.classList.remove('hidden');
      const host = document.getElementById('portalThread');
      await populateProjectFilter();
      await loadPortalThread(host);
      startPolling(host);
      return;
    }
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    await loadAdminList();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(init, 120);
  });
})();
