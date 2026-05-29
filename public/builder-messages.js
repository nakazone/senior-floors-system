/* global crmNotify */
(function () {
  function isPortal() {
    return !!window.builderAuth?.getToken?.();
  }
  const params = new URLSearchParams(location.search);
  let activeBuilderId = params.get('builder_id') ? parseInt(params.get('builder_id'), 10) : null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function fmtTime(d) {
    if (!d) return '';
    return String(d).slice(0, 16).replace('T', ' ');
  }

  function renderMessages(host, messages, opts) {
    const { showInternal = false, builder } = opts;
    let html = '';
    if (builder) {
      html += `<header class="bp-msg-header"><strong>${escapeHtml(builder.company || builder.first_name + ' ' + builder.last_name)}</strong></header>`;
    }
    html += '<div class="bp-msg-scroll" id="msgScroll">';
    let lastDate = '';
    (messages || []).forEach((m) => {
      const day = String(m.created_at).slice(0, 10);
      if (day !== lastDate) {
        lastDate = day;
        html += `<div class="bp-msg-date">${day}</div>`;
      }
      const mine = isPortal ? m.sender_type === 'builder' : m.sender_type === 'admin';
      const internal = m.is_internal_note === 1 || m.is_internal_note === true;
      if (internal && !showInternal) return;
      html += `<div class="bp-msg-bubble ${mine ? 'bp-msg-bubble--mine' : ''} ${internal ? 'bp-msg-bubble--note' : ''}">
        <p>${escapeHtml(m.message)}</p>
        <span class="bp-msg-time">${fmtTime(m.created_at)}${internal ? ' — — nota interna' : ''}</span>
      </div>`;
    });
    html += '</div>';
    html += `<footer class="bp-msg-compose">
      ${!isPortal() ? '<label style="font-size:11px;display:flex;align-items:center;gap:6px;margin-bottom:6px"><input type="checkbox" id="internalNote" /> Nota interna (s… equipa)</label>' : ''}
      <textarea id="msgInput" rows="2" placeholder="Escreva uma mensagem…"></textarea>
      <button type="button" class="bp-btn-tan" id="btnSend">Enviar</button>
    </footer>`;
    host.innerHTML = html;
    const scroll = document.getElementById('msgScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    document.getElementById('btnSend')?.addEventListener('click', () => sendMessage(host, opts));
  }

  async function sendMessage(host, opts) {
    const text = document.getElementById('msgInput')?.value?.trim();
    if (!text) return;
    const body = { message: text };
    if (isPortal()) {
      const r = await window.builderAuth.fetch('/api/builder-messages/partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        crmNotify('Erro ao enviar', 'error');
        return;
      }
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
        crmNotify(j.error || 'Erro', 'error');
        return;
      }
      await loadAdminThread(activeBuilderId);
    }
  }

  async function loadAdminThread(builderId) {
    activeBuilderId = builderId;
    const r = await fetch(
      `/api/builder-messages/thread/${builderId}?include_internal=1`,
      { credentials: 'include' }
    );
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
      list.innerHTML = '<p style="padding:12px">Sem conversas. Envie mensagem a partir do perfil do builder.</p>';
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
    const r = await window.builderAuth.fetch('/api/builder-messages/partner/thread');
    const j = await r.json();
    if (!j.success) {
      host.innerHTML = '<p>Could not load messages.</p>';
      return;
    }
    renderMessages(host, j.data.messages, { builder: j.data.builder });
  }

  async function init() {
    if (isPortal()) {
      if (!window.builderAuth.requireAuth()) return;
      document.getElementById('adminShell').classList.add('hidden');
      document.getElementById('portalShell').classList.remove('hidden');
      await loadPortalThread(document.getElementById('portalThread'));
      return;
    }
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    await loadAdminList();
  }

  init();
})();
