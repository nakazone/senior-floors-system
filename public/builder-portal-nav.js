/* global document */
(function () {
  const PAGES = [
    { id: 'dashboard', href: 'builder-portal.html', label: 'Dashboard' },
    { id: 'projects', href: 'builder-projects.html', label: 'My Projects' },
    { id: 'calendar', href: 'builder-calendar.html', label: 'Calendar' },
    { id: 'calculator', href: 'builder-calculator.html', label: 'Calculator' },
    { id: 'estimate', href: 'builder-estimate-request.html', label: 'Request estimate' },
    { id: 'pricing', href: 'builder-pricing.html', label: 'Pricing' },
    { id: 'gallery', href: 'builder-gallery.html', label: 'Gallery' },
    { id: 'messages', href: 'builder-messages.html', label: 'Messages' },
    { id: 'history', href: 'builder-history.html', label: 'History' },
    { id: 'referrals', href: 'builder-referrals.html', label: 'Referrals' },
    { id: 'profile', href: 'builder-profile.html', label: 'Profile' },
  ];

  function currentPage() {
    const fromBody = document.body?.dataset?.bpPage;
    if (fromBody) return fromBody;
    const file = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    const map = {
      'builder-portal': 'dashboard',
      'builder-projects': 'projects',
      'builder-project': 'projects',
      'builder-calendar': 'calendar',
      'builder-calculator': 'calculator',
      'builder-estimate-request': 'estimate',
      'builder-pricing': 'pricing',
      'builder-gallery': 'gallery',
      'builder-messages': 'messages',
      'builder-history': 'history',
      'builder-referrals': 'referrals',
      'builder-profile': 'profile',
    };
    return map[file] || '';
  }

  function renderNav(active) {
    const nav = document.getElementById('bpPortalNav');
    if (!nav) return;
    nav.innerHTML = PAGES.map((p) => {
      const badge =
        p.id === 'messages'
          ? ' <span class="bp-nav-badge hidden" id="bpNavMsgBadge" aria-label="Unread"></span>'
          : '';
      return `<a href="${p.href}"${p.id === active ? ' class="active"' : ''}>${p.label}${badge}</a>`;
    }).join('');
    window.builderPortalCommon?.refreshUnreadBadges?.();
  }

  window.builderPortalNav = { renderNav, currentPage };
  document.addEventListener('DOMContentLoaded', () => renderNav(currentPage()));
})();
