(function () {
  let me = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function docStatusLabel(status) {
    const map = {
      valid: 'Valid',
      pending_review: 'Pending review',
      expired: 'Expired',
      rejected: 'Rejected',
    };
    return map[status] || status || '—';
  }

  function renderDocs(docs) {
    const list = docs || me?.documents || [];
    document.getElementById('docList').innerHTML = list.length
      ? `<div class="bp-table-wrap"><table class="bp-table"><thead><tr><th>Document</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>${list
          .map((d) => {
            const dl = d.download_url || d.url;
            const del =
              d.can_delete
                ? `<button type="button" class="bp-link-btn bp-doc-del" data-id="${d.id}">Remove</button>`
                : '';
            return `<tr>
              <td>${d.url ? `<a href="${escapeHtml(dl)}" target="_blank" rel="noopener">${escapeHtml(d.name)}</a>` : escapeHtml(d.name)}</td>
              <td>${escapeHtml(docStatusLabel(d.status))}</td>
              <td>${escapeHtml(String(d.expires_at || '').slice(0, 10) || '—')}</td>
              <td>${del}</td>
            </tr>`;
          })
          .join('')}</tbody></table></div>`
      : '<p class="bp-muted">No documents on file yet. Upload insurance, license, or W-9 below.</p>';

    document.querySelectorAll('.bp-doc-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this document?')) return;
        const r = await window.builderAuth.fetch(`/api/builder-documents/${btn.dataset.id}`, {
          method: 'DELETE',
        });
        const j = await r.json();
        if (!r.ok) alert(j.error || 'Could not delete');
        else loadDocs();
      });
    });
  }

  async function loadDocs() {
    const r = await window.builderAuth.fetch('/api/builder-documents');
    const j = await r.json();
    if (j.success) renderDocs(j.data);
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-auth/me');
    const j = await r.json();
    if (!j.success) return;
    me = j.data;
    document.getElementById('first_name').value = me.first_name || '';
    document.getElementById('last_name').value = me.last_name || '';
    document.getElementById('phone').value = me.phone || '';
    document.getElementById('company').value = me.company || '';
    document.getElementById('website').value = me.website || '';
    document.getElementById('email').value = me.email || '';

    const prefs = me.notification_prefs || {};
    document.getElementById('pref_project').checked = prefs.project_status !== false;
    document.getElementById('pref_message').checked = prefs.messages !== false;
    document.getElementById('pref_checklist').checked = prefs.checklist !== false;
    document.getElementById('pref_documents').checked = prefs.documents !== false;

    const mgr = me.account_manager;
    document.getElementById('managerBlock').innerHTML = mgr
      ? `<strong>Your Senior Floors manager</strong>
        <p style="margin:6px 0 0">${escapeHtml(mgr.name || '')}</p>
        <p class="bp-muted">${escapeHtml(mgr.email || '')}</p>
        <a href="builder-messages.html" class="bp-btn-tan" style="display:inline-block;margin-top:10px;text-decoration:none;font-size:13px">Send message</a>`
      : '<p class="bp-muted">Your account manager will be assigned by Senior Floors.</p>';

    renderDocs(me.documents);
  }

  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await window.builderAuth.fetch('/api/builder-auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: document.getElementById('first_name').value,
        last_name: document.getElementById('last_name').value,
        phone: document.getElementById('phone').value,
        company: document.getElementById('company').value,
        website: document.getElementById('website').value,
      }),
    });
    const j = await r.json();
    alert(j.success ? 'Profile saved' : j.error || 'Error');
    if (j.success) load();
  });

  document.getElementById('btnSavePrefs')?.addEventListener('click', async () => {
    const r = await window.builderAuth.fetch('/api/builder-auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification_prefs: {
          project_status: document.getElementById('pref_project').checked,
          messages: document.getElementById('pref_message').checked,
          checklist: document.getElementById('pref_checklist').checked,
          documents: document.getElementById('pref_documents').checked,
        },
      }),
    });
    const j = await r.json();
    alert(j.success ? 'Preferences saved' : j.error || 'Error');
  });

  document.getElementById('docUploadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('docFile')?.files?.[0];
    const status = document.getElementById('docUploadStatus');
    if (!file) {
      status.textContent = 'Select a file.';
      return;
    }
    status.textContent = 'Uploading...';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', document.getElementById('docName')?.value || file.name);
    fd.append('type', document.getElementById('docType')?.value || 'other');
    const exp = document.getElementById('docExpires')?.value;
    if (exp) fd.append('expires_at', exp);
    const r = await window.builderAuth.fetch('/api/builder-documents', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) {
      status.textContent = j.error || 'Upload failed';
      return;
    }
    status.textContent = 'Uploaded — pending Senior Floors review.';
    e.target.reset();
    loadDocs();
  });

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.builderAuth?.getToken()) load();
    }, 150);
  });
})();
