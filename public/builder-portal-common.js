/* global sessionStorage, window, document, location */
(function () {
  const RETURN_KEY = 'sf_builder_return_url';
  const SKIP_PASSWORD_PAGES = [
    'builder-login',
    'builder-forgot-password',
    'builder-reset-password',
    'builder-change-password',
  ];

  function pageStem() {
    return (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function enhanceAuthFetch() {
    if (!window.builderAuth || window.builderAuth._portalEnhanced) return;
    const orig = window.builderAuth.fetch.bind(window.builderAuth);
    window.builderAuth.fetch = async function (path, opts) {
      const r = await orig(path, opts);
      if (r.status === 401 && !SKIP_PASSWORD_PAGES.includes(pageStem())) {
        sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
        location.href = 'builder-login.html?expired=1';
      }
      return r;
    };
    window.builderAuth._portalEnhanced = true;
  }

  async function guardPortalPage() {
    if (!window.builderAuth) return false;
    enhanceAuthFetch();
    const stem = pageStem();
    if (SKIP_PASSWORD_PAGES.includes(stem)) return true;
    if (!window.builderAuth.getToken()) {
      sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
      location.href = 'builder-login.html';
      return false;
    }
    try {
      const r = await window.builderAuth.fetch('/api/builder-auth/me');
      const j = await r.json();
      if (!j.success) return false;
      if (j.data.portal_password_must_change && stem !== 'builder-change-password') {
        location.href = 'builder-change-password.html?required=1';
        return false;
      }
      window.builderPortalUser = j.data;
      return true;
    } catch {
      return false;
    }
  }

  async function loadPortalHeader() {
    const slot = document.getElementById('bpPortalHeader');
    if (!slot) return;
    let unread = { messages: 0, notifications: 0, total: 0 };
    try {
      const r = await window.builderAuth.fetch('/api/builder-notifications/unread-count');
      const j = await r.json();
      if (j.success) unread = j.data;
    } catch (_) {}

    const u = window.builderPortalUser || {};
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Partner';

    slot.innerHTML = `
      <div class="bp-header-bar">
        <div class="bp-header-bar__user">
          <a href="builder-profile.html" class="bp-header-avatar" title="Profile">${escapeHtml((u.first_name || 'B')[0])}</a>
          <div>
            <div class="bp-header-bar__name">${escapeHtml(name)}</div>
            <div class="bp-header-bar__co">${escapeHtml(u.company || '')}</div>
          </div>
        </div>
        <div class="bp-header-bar__actions">
          <div class="bp-notif-wrap">
            <button type="button" class="bp-notif-btn" id="bpNotifBtn" aria-label="Notifications">
              &#128276;
              ${unread.total > 0 ? `<span class="bp-notif-badge">${unread.total > 99 ? '99+' : unread.total}</span>` : ''}
            </button>
            <div class="bp-notif-dropdown hidden" id="bpNotifDropdown"></div>
          </div>
          <button type="button" class="bp-btn-ghost" id="btnPortalLogout">Logout</button>
        </div>
      </div>`;

    document.getElementById('btnPortalLogout')?.addEventListener('click', () => {
      window.builderAuth.setToken(null);
      location.href = 'builder-login.html';
    });

    document.getElementById('bpNotifBtn')?.addEventListener('click', async () => {
      const dd = document.getElementById('bpNotifDropdown');
      if (!dd) return;
      if (!dd.classList.contains('hidden')) {
        dd.classList.add('hidden');
        return;
      }
      dd.classList.remove('hidden');
      dd.innerHTML = '<p class="bp-muted" style="padding:12px">Loading...</p>';
      const r = await window.builderAuth.fetch('/api/builder-notifications?limit=15');
      const j = await r.json();
      const rows = j.data || [];
      dd.innerHTML =
        `<div class="bp-notif-head">
          <strong>Notifications</strong>
          <button type="button" class="bp-link-btn" id="bpMarkAllRead">Mark all read</button>
        </div>` +
        (rows.length
          ? rows
              .map(
                (n) =>
                  `<a href="${escapeHtml(n.link_url || '#')}" class="bp-notif-item${n.is_read ? '' : ' bp-notif-item--unread'}">
                    <span class="bp-notif-item__title">${escapeHtml(n.title)}</span>
                    <span class="bp-notif-item__body">${escapeHtml(n.body || '')}</span>
                    <span class="bp-notif-item__time">${escapeHtml(String(n.created_at || '').slice(0, 16))}</span>
                  </a>`
              )
              .join('')
          : '<p class="bp-muted" style="padding:12px">No notifications yet.</p>') +
        `<div class="bp-notif-foot"><a href="builder-profile.html#notifications">Manage preferences</a></div>`;
      document.getElementById('bpMarkAllRead')?.addEventListener('click', async () => {
        await window.builderAuth.fetch('/api/builder-notifications/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
        loadPortalHeader();
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.bp-notif-wrap')) {
        document.getElementById('bpNotifDropdown')?.classList.add('hidden');
      }
    });
  }

  function wireMobileNav() {
    const btn = document.getElementById('bpMenuToggle');
    const sidebar = document.querySelector('.bp-portal-sidebar');
    if (btn && sidebar) {
      btn.addEventListener('click', () => sidebar.classList.toggle('bp-sidebar--open'));
    }
  }

  window.builderPortalCommon = {
    guardPortalPage,
    loadPortalHeader,
    wireMobileNav,
    RETURN_KEY,
  };

  document.addEventListener('DOMContentLoaded', async () => {
    if (!window.builderAuth) return;
    const stem = pageStem();
    if (SKIP_PASSWORD_PAGES.includes(stem)) return;
    const ok = await guardPortalPage();
    if (!ok) return;
    if (window.builderPortalNav?.renderNav) {
      window.builderPortalNav.renderNav(window.builderPortalNav.currentPage());
    }
    await loadPortalHeader();
    wireMobileNav();
  });
})();
