/* global fetch, crmNotify */
(function () {
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10);
  const root = document.getElementById('detailRoot');

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initials(b) {
    return ((b.first_name || '')[0] || '') + ((b.last_name || '')[0] || '') || '?';
  }

  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'include', ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  function render(b, projects, accessLog) {
    const months =
      b.created_at
        ? Math.max(
            1,
            Math.round(
              (Date.now() - new Date(b.created_at).getTime()) / (30 * 24 * 3600 * 1000)
            )
          )
        : 0;
    const projRows = (projects || [])
      .map(
        (p) => `<tr>
          <td><a href="project-detail.html?id=${p.id}">${escapeHtml(p.name || p.project_number || '#' + p.id)}</a></td>
          <td>${escapeHtml(p.address || '—')}</td>
          <td>${escapeHtml(p.status || '')}</td>
          <td>${p.contract_value != null ? '$' + Number(p.contract_value).toLocaleString() : '—'}</td>
        </tr>`
      )
      .join('');

    root.innerHTML = `
      <aside class="bp-card">
        <div class="bd-avatar">${escapeHtml(initials(b))}</div>
        <h2 class="bp-title" style="font-size:1.1rem">${escapeHtml(b.first_name)} ${escapeHtml(b.last_name)}</h2>
        <p style="color:var(--bp-muted);margin:0 0 12px">${escapeHtml(b.company || '')}</p>
        <p><strong>Email:</strong> ${escapeHtml(b.email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(b.phone || '—')}</p>
        <p><strong>Parceiro há:</strong> ${months} meses</p>
        <p><strong>Último login:</strong> ${b.last_login ? escapeHtml(String(b.last_login).slice(0, 16)) : '—'}</p>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
          <a class="bp-btn-tan" style="text-align:center;text-decoration:none" href="builder-messages.html?builder_id=${b.id}">Mensagens</a>
          <a class="btn btn-secondary" style="text-align:center" href="builder-login.html" target="_blank" rel="noopener">Ver portal (login)</a>
          <button type="button" class="btn btn-secondary" id="btnResetPw">Resetar senha portal</button>
        </div>
      </aside>
      <div>
        <div class="bd-tabs" role="tablist">
          <button type="button" class="active" data-tab="overview">Visão Geral</button>
          <button type="button" data-tab="projects">Projetos (${(projects || []).length})</button>
          <button type="button" data-tab="access">Acesso ao Portal</button>
        </div>
        <div class="bd-panel active" id="tab-overview">
          <div class="bp-card">
            <p><strong>Status:</strong> ${escapeHtml(b.status)} · <strong>Tipo:</strong> ${escapeHtml(b.type || '')}</p>
            <p><strong>Nota interna:</strong></p>
            <textarea id="internalNote" rows="4" style="width:100%">${escapeHtml(b.internal_note || '')}</textarea>
            <button type="button" class="bp-btn-tan" id="btnSaveNote" style="margin-top:8px">Guardar nota</button>
          </div>
        </div>
        <div class="bd-panel" id="tab-projects">
          <div class="bp-table-wrap"><table class="bp-table"><thead><tr><th>Projeto</th><th>Endereço</th><th>Status</th><th>Valor</th></tr></thead><tbody>${projRows || '<tr><td colspan="4">Sem projetos</td></tr>'}</tbody></table></div>
        </div>
        <div class="bd-panel" id="tab-access">
          <div class="bp-card">
            <p>Portal: ${b.portal_access ? 'Ativo' : 'Sem acesso'} ${b.portal_blocked ? '(bloqueado)' : ''}</p>
            <table class="bp-table"><thead><tr><th>Data</th><th>Ação</th><th>IP</th></tr></thead><tbody>
              ${(accessLog || [])
                .map(
                  (l) =>
                    `<tr><td>${escapeHtml(String(l.created_at).slice(0, 19))}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.ip_address || '—')}</td></tr>`
                )
                .join('') || '<tr><td colspan="3">Sem registos</td></tr>'}
            </tbody></table>
          </div>
        </div>
      </div>`;

    root.querySelectorAll('.bd-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.bd-tabs button').forEach((x) => x.classList.remove('active'));
        root.querySelectorAll('.bd-panel').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    document.getElementById('btnSaveNote').addEventListener('click', async () => {
      try {
        await api(`/api/builders/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ internal_note: document.getElementById('internalNote').value }),
        });
        crmNotify('Nota guardada.', 'success');
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });

    document.getElementById('btnResetPw').addEventListener('click', async () => {
      try {
        const j = await api(`/api/builders/${id}/reset-portal-password`, { method: 'POST' });
        crmNotify(`Nova senha: ${j.data.temp_password}`, 'success', 15000);
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    if (!Number.isFinite(id)) {
      root.textContent = 'ID inválido';
      return;
    }
    try {
      const j = await api(`/api/builders/${id}`);
      render(j.data.builder, j.data.projects, j.data.access_log);
    } catch (e) {
      root.textContent = e.message;
    }
  }

  init();
})();
