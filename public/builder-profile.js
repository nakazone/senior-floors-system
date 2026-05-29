(function () {
  let me = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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

    const docs = me.documents || [];
    document.getElementById('docList').innerHTML = docs.length
      ? `<table class="bp-table"><thead><tr><th>Document</th><th>Status</th><th>Expires</th></tr></thead><tbody>${docs
          .map(
            (d) =>
              `<tr><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.status)}</td><td>${escapeHtml(String(d.expires_at || '').slice(0, 10) || '—')}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<p class="bp-muted">No documents on file yet.</p>';
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

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.builderAuth?.getToken()) load();
    }, 150);
  });
})();
