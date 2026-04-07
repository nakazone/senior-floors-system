/**
 * Menu CRM padrão (mesmas entradas que dashboard.html sidebar) em páginas standalone.
 * Respeita permissões via GET /api/auth/session.
 */
(function () {
  /** Mesma ordem e itens que o sidebar do dashboard.html (sem «Ferramentas» no lateral). */
  const MAIN_NAV = [
    { href: 'dashboard.html', label: 'Dashboard', perm: null, page: '' },
    { href: 'marketing.html', label: 'Marketing', perm: 'reports.view', page: '' },
    { href: 'dashboard.html?page=leads', label: 'Leads', perm: 'leads.view', page: 'leads' },
    { href: 'dashboard.html?page=crm', label: 'CRM', perm: 'pipeline.view', page: 'crm' },
    { href: 'dashboard.html?page=customers', label: 'Clients', perm: 'customers.view', page: 'customers' },
    { href: 'dashboard.html?page=quotes', label: 'Quotes', perm: 'quotes.view', page: 'quotes' },
    { href: 'dashboard.html?page=schedule', label: 'Schedule', perm: 'visits.view', page: 'schedule' },
    { href: 'projects.html', label: 'Projetos', perm: 'projects.view', page: '' },
    { href: 'dashboard.html?page=financeiro', label: 'Financeiro', perm: 'contracts.view', page: 'financeiro' },
    { href: 'payroll-module.html', label: 'Folha de pagamento', perm: 'payroll.view', page: '' },
    { href: 'dashboard.html?page=activities', label: 'Activities', perm: 'activities.view', page: 'activities' },
    { href: 'dashboard.html?page=users', label: 'Users', perm: 'users.view', page: 'users' },
  ];

  /** Só na barra horizontal (páginas sem sidebar); não aparece no menu lateral fixo. */
  const TOOL_NAV = [
    { href: 'quote-builder.html', label: 'Novo orçamento', perm: 'quotes.edit' },
    { href: 'onsite-quote.html', label: 'Quick quote', perm: 'quotes.create' },
    { href: 'quote-catalog.html', label: 'Catálogo', perm: 'quotes.edit' },
    { href: 'suppliers.html', label: 'Fornecedores', perm: 'quotes.view' },
    { href: 'products-erp.html', label: 'Produtos ERP', perm: 'quotes.view' },
    { href: 'estimate-builder.html', label: 'Estimate', perm: 'quotes.view' },
    { href: 'estimate-analytics.html', label: 'Est. analytics', perm: 'quotes.view' },
  ];

  function currentFile() {
    const p = (window.location.pathname || '').split('/').pop() || '';
    return p.toLowerCase();
  }

  function pageParam() {
    return new URLSearchParams(window.location.search).get('page') || '';
  }

  function linkActive(item, file, page) {
    const h = item.href || '';
    const base = h.split('?')[0].split('/').pop().toLowerCase();
    if (base === 'marketing.html') {
      return file === 'marketing.html';
    }
    if (base === 'projects.html') {
      return file === 'projects.html';
    }
    if (h.indexOf('dashboard.html') === 0) {
      if (file !== 'dashboard.html') return false;
      const expected = item.page || '';
      return (page || '') === expected;
    }
    const toolFile = h.split('?')[0].split('/').pop().toLowerCase();
    return file === toolFile;
  }

  function canSee(perm, role, keys) {
    if (!perm) return true;
    if (role === 'admin') return true;
    return keys.has(perm);
  }

  async function init() {
    const host = document.getElementById('crmSharedNavRoot');
    if (!host) return;

    let perms = [];
    let role = '';
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      const j = await r.json();
      if (j.authenticated && j.user) {
        perms = Array.isArray(j.user.permissions) ? j.user.permissions : [];
        role = j.user.role || '';
      }
    } catch (_) {}

    const keys = new Set(perms);
    const file = currentFile();
    const page = pageParam();

    if (host.dataset.layout === 'sidebar') {
      const stack = document.createElement('div');
      stack.className = 'crm-sidebar-nav-stack';

      MAIN_NAV.forEach((item) => {
        if (!canSee(item.perm, role, keys)) return;
        const a = document.createElement('a');
        a.href = item.href;
        a.className = 'nav-item' + (linkActive(item, file, page) ? ' active' : '');
        a.textContent = item.label;
        stack.appendChild(a);
      });

      host.appendChild(stack);
      return;
    }

    const nav = document.createElement('nav');
    nav.className = 'crm-shared-nav';
    nav.setAttribute('aria-label', 'Navegação principal CRM');

    const inner = document.createElement('div');
    inner.className = 'crm-shared-nav__inner';

    const brand = document.createElement('a');
    brand.className = 'crm-shared-nav__brand';
    brand.href = 'dashboard.html';
    brand.innerHTML =
      '<img src="/assets/SeniorFloors.png" alt="" width="28" height="28" onerror="this.style.display=\'none\'" />';
    brand.appendChild(document.createTextNode(' CRM'));
    inner.appendChild(brand);

    MAIN_NAV.forEach((item) => {
      if (!canSee(item.perm, role, keys)) return;
      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'crm-shared-nav__link' + (linkActive(item, file, page) ? ' crm-shared-nav__link--active' : '');
      a.textContent = item.label;
      inner.appendChild(a);
    });

    const sep = document.createElement('span');
    sep.className = 'crm-shared-nav__sep';
    sep.setAttribute('aria-hidden', 'true');
    inner.appendChild(sep);

    const lab = document.createElement('span');
    lab.className = 'crm-shared-nav__label crm-shared-nav__label--tools';
    lab.textContent = 'Ferramentas';
    inner.appendChild(lab);

    TOOL_NAV.forEach((item) => {
      if (!canSee(item.perm, role, keys)) return;
      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'crm-shared-nav__link' + (linkActive(item, file, page) ? ' crm-shared-nav__link--active' : '');
      a.textContent = item.label;
      inner.appendChild(a);
    });

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'crm-shared-nav__logout';
    logout.textContent = 'Sair';
    logout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      window.location.href = 'login.html';
    });
    inner.appendChild(logout);

    nav.appendChild(inner);
    host.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
