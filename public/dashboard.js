/**
 * Dashboard JavaScript - Main functionality
 */
let currentPage = 1;
let currentPageName = 'dashboard';
let dashboardStats = null;
let chartInstances = {};
let lastLeadCount = null;
const NEW_LEAD_POLL_INTERVAL_MS = 30000; // 30s
let newLeadPollTimer = null;

/** Permissões do utilizador com sessão (menu + módulo Users) */
let crmUserPermissions = [];
let crmUserRole = '';

/** Viewport mobile (coexiste com desktop ≥768px) — usar matchMedia, não user-agent */
const sfMobileMq = window.matchMedia('(max-width: 768px)');

/** Cache da página atual de orçamentos para pesquisa client-side no cartão mobile */
let sfQuotesListCache = [];

/** Slug → cor hex (lista de leads alinhada às colunas do Kanban) */
let leadsPipelineSlugToColor = null;

function sanitizeLeadStageHexColor(c) {
    if (c == null || c === undefined) return '';
    const s = String(c).trim();
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(s) ? s : '';
}

function escapeHtmlLeadList(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

async function ensureLeadsPipelineColorMap() {
    if (leadsPipelineSlugToColor) return;
    leadsPipelineSlugToColor = {};
    try {
        const response = await fetch('/api/pipeline-stages', { credentials: 'include' });
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
            const fallback = '#94a3b8';
            data.data.forEach((stage) => {
                if (!stage || !stage.slug) return;
                leadsPipelineSlugToColor[stage.slug] = sanitizeLeadStageHexColor(stage.color) || fallback;
            });
        }
    } catch (e) {
        leadsPipelineSlugToColor = {};
    }
}

function resolveLeadRowStageColor(lead) {
    const fallback = '#94a3b8';
    const fromJoin = sanitizeLeadStageHexColor(lead.pipeline_stage_color);
    if (fromJoin) return fromJoin;
    const slug = lead.pipeline_stage_slug || lead.status;
    if (slug && leadsPipelineSlugToColor && leadsPipelineSlugToColor[slug]) {
        return leadsPipelineSlugToColor[slug];
    }
    return fallback;
}

function applyCrmNavPermissions(permissions, role) {
    const keys = new Set(permissions || []);
    const isAdmin = role === 'admin';
    window.__crmPaletteRole = role || '';
    window.__crmPalettePerms = Array.isArray(permissions) ? permissions.slice() : [];
    document.querySelectorAll('[data-crm-permission]').forEach((el) => {
        const need = el.getAttribute('data-crm-permission');
        if (!need) return;
        if (isAdmin || keys.has(need)) {
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    });
    updateUsersPageActions();
}

function updateUsersPageActions() {
    const n = document.getElementById('crmNewUserBtn');
    if (!n) return;
    const show = crmUserRole === 'admin' || crmUserPermissions.includes('users.create');
    n.style.display = show ? '' : 'none';
}

fetch('/api/auth/session', { credentials: 'include' })
    .then((r) => r.json())
    .then((data) => {
        if (!data.authenticated) {
            window.location.href = '/login.html';
            return;
        }
        const u = data.user || {};
        if (u.must_change_password) {
            window.location.href = '/change-password.html';
            return;
        }
        crmUserPermissions = Array.isArray(u.permissions) ? u.permissions : [];
        crmUserRole = u.role || '';
        const disp = (u.name && String(u.name).trim()) || u.email || 'Utilizador';
        const sn = document.getElementById('sidebarUserName');
        const sr = document.getElementById('sidebarUserRole');
        const sa = document.getElementById('sidebarUserAvatar');
        if (sn) sn.textContent = disp;
        if (sr) sr.textContent = crmUserRole ? String(crmUserRole) : '';
        if (sa) {
            const ch = disp.trim().charAt(0).toUpperCase();
            sa.textContent = ch && /[A-Z0-9]/.test(ch) ? ch : '?';
        }
        applyCrmNavPermissions(crmUserPermissions, crmUserRole);
        if (typeof applySfMobileShell === 'function') applySfMobileShell();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        }
        loadDashboard();
        startNewLeadPolling();
        const pageParam = new URLSearchParams(window.location.search).get('page');
        if (pageParam && document.querySelector(`#dashboardSidebar [data-page="${pageParam}"]`)) {
            showPage(pageParam);
        }
    })
    .catch((err) => {
        console.error('Session check error:', err);
        window.location.href = '/login.html';
    });

// Popup toast no canto inferior – novo lead recebido
function showNewLeadToast(count, message) {
    var msg = message || (count === 1 ? '1 novo lead. Contate em até 30 min!' : count + ' novos leads. Contate em até 30 min!');
    if (typeof window.addCrmNotification === 'function') {
        window.addCrmNotification({
            title: count === 1 ? 'Novo lead recebido' : count + ' novos leads',
            body: msg,
            type: 'lead_new',
            action: { kind: 'page', page: 'leads' },
        });
    }
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast-lead';
    toast.setAttribute('role', 'alert');
    toast.innerHTML =
        '<span class="toast-lead-icon">!</span>' +
        '<div class="toast-lead-body">' +
        '<div class="toast-lead-title">Novo lead recebido!</div>' +
        '<div class="toast-lead-msg">' + msg + '</div>' +
        '</div>' +
        '<button type="button" class="toast-lead-btn" onclick="this.closest(\'.toast-lead\').remove(); showPage(\'leads\');">Ver leads</button>';
    container.appendChild(toast);
    setTimeout(function () {
        if (toast.parentNode) toast.remove();
    }, 8000);
}

// Auto-refresh: poll for new leads and show notification
function startNewLeadPolling() {
    if (newLeadPollTimer) return;
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    function poll() {
        fetch('/api/leads?limit=1&page=1', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                if (!data.success || typeof data.total !== 'number') return;
                const total = data.total;
                if (lastLeadCount !== null && total > lastLeadCount) {
                    const n = total - lastLeadCount;
                    const msg = n === 1 ? '1 novo lead recebido.' : n + ' novos leads recebidos.';
                    showNewLeadToast(n, msg);
                    if ('Notification' in window && Notification.permission === 'granted') {
                        try { new Notification('Senior Floors CRM – Novo lead', { body: msg }); } catch (e) {}
                    }
                    if (currentPageName === 'dashboard') loadDashboard();
                    if (currentPageName === 'leads' && typeof loadLeads === 'function') loadLeads();
                    if (currentPageName === 'crm' && typeof loadCRMKanban === 'function') loadCRMKanban();
                }
                lastLeadCount = total;
            })
            .catch(() => {});
    }
    poll();
    newLeadPollTimer = setInterval(poll, NEW_LEAD_POLL_INTERVAL_MS);
}

// Logout
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
});

// Mobile menu toggle
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const dashboardSidebar = document.getElementById('dashboardSidebar');
const mobileOverlay = document.getElementById('mobileOverlay');

function isMobile() {
    return window.innerWidth <= 768;
}

const MOBILE_PAGE_TITLES = {
    dashboard: 'Dashboard',
    marketing: 'Marketing',
    leads: 'Leads',
    crm: 'CRM',
    customers: 'Clientes',
    quotes: 'Orçamentos',
    projects: 'Projetos',
    schedule: 'Agenda',
    financeiro: 'Financeiro',
    activities: 'Atividades',
    users: 'Utilizadores',
};

/** Módulos no drawer “Mais” (tabs principais Home/Quotes/Clients ficam na barra) */
const MOBILE_MORE_PAGES = new Set([
    'marketing',
    'leads',
    'crm',
    'projects',
    'schedule',
    'financeiro',
    'activities',
    'users',
]);

function setMobileMenuOpen(open) {
    if (!dashboardSidebar || !mobileOverlay) return;
    dashboardSidebar.classList.toggle('mobile-open', open);
    mobileOverlay.classList.toggle('active', open);
    if (mobileMenuToggle) mobileMenuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncMobileAppChrome(pageName) {
    const titleEl = document.getElementById('mobileAppTitle');
    if (titleEl) {
        titleEl.textContent = MOBILE_PAGE_TITLES[pageName] || pageName;
    }
    document.querySelectorAll('#mobileTabBar .mobile-tab-bar__item').forEach((btn) => {
        const tab = btn.dataset.mobileTab;
        if (!tab) return;
        const inMore = MOBILE_MORE_PAGES.has(pageName);
        const active = tab === 'more' ? inMore : tab === pageName;
        btn.classList.toggle('mobile-tab-bar__item--active', active);
        if (active) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
    if (isMobile()) {
        try {
            window.scrollTo(0, 0);
        } catch (e) {}
        const main = document.querySelector('.dashboard-main');
        if (main && typeof main.scrollTop === 'number') main.scrollTop = 0;
        const pageEl = document.getElementById(pageName + 'Page');
        if (pageEl) {
            pageEl.classList.remove('mobile-page-flash');
            void pageEl.offsetWidth;
            pageEl.classList.add('mobile-page-flash');
        }
    }
}

function closeMobileMoreSheet() {
    const backdrop = document.getElementById('mobileMoreBackdrop');
    const sheet = document.getElementById('mobileMoreSheet');
    if (backdrop) backdrop.hidden = true;
    if (sheet) sheet.hidden = true;
    document.body.classList.remove('mobile-more-open');
}

function openMobileMoreSheet() {
    const backdrop = document.getElementById('mobileMoreBackdrop');
    const sheet = document.getElementById('mobileMoreSheet');
    if (!backdrop || !sheet) return;
    closeSfFabSheet();
    backdrop.hidden = false;
    sheet.hidden = false;
    document.body.classList.add('mobile-more-open');
}

function updateMobileChromeVisibility() {
    const header = document.getElementById('mobileAppHeader');
    const tabBar = document.getElementById('mobileTabBar');
    const m = isMobile();
    if (header) header.setAttribute('aria-hidden', m ? 'false' : 'true');
    if (tabBar) tabBar.setAttribute('aria-hidden', m ? 'false' : 'true');
    if (!m) closeMobileMoreSheet();
}

function updateMobileMenuVisibility() {
    if (mobileMenuToggle && dashboardSidebar) {
        if (isMobile()) {
            mobileMenuToggle.style.display = 'flex';
        } else {
            mobileMenuToggle.style.display = 'none';
            setMobileMenuOpen(false);
        }
    }
    updateMobileChromeVisibility();
}

function applySfMobileShell() {
    document.body.classList.toggle('sf-mobile-shell', sfMobileMq.matches);
    updateMobileMenuVisibility();
    if (!sfMobileMq.matches) closeSfFabSheet();
    else if (typeof currentPageName === 'string' && currentPageName === 'quotes' && typeof renderQuotesMobileFromCache === 'function') {
        renderQuotesMobileFromCache();
    }
}

sfMobileMq.addEventListener('change', () => applySfMobileShell());

window.addEventListener('resize', () => {
    applySfMobileShell();
    if (!isMobile()) {
        setMobileMenuOpen(false);
    }
});

if (mobileMenuToggle && dashboardSidebar && mobileOverlay) {
    mobileMenuToggle.addEventListener('click', () => {
        const open = !dashboardSidebar.classList.contains('mobile-open');
        setMobileMenuOpen(open);
    });

    mobileOverlay.addEventListener('click', () => {
        setMobileMenuOpen(false);
    });

    dashboardSidebar.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => {
            if (isMobile()) {
                dashboardSidebar.classList.remove('mobile-open');
                mobileOverlay.classList.remove('active');
            }
        });
    });
}
applySfMobileShell();

const mobileTabBarEl = document.getElementById('mobileTabBar');
if (mobileTabBarEl) {
    mobileTabBarEl.querySelectorAll('[data-mobile-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const t = btn.dataset.mobileTab;
            if (t === 'more') {
                closeSfFabSheet();
                openMobileMoreSheet();
                return;
            }
            closeMobileMoreSheet();
            closeSfFabSheet();
            showPage(t);
        });
    });
}

const mobileMoreSheetEl = document.getElementById('mobileMoreSheet');
if (mobileMoreSheetEl) {
    mobileMoreSheetEl.querySelectorAll('[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const p = btn.dataset.page;
            closeMobileMoreSheet();
            if (p) showPage(p);
        });
    });
}

document.getElementById('mobileMoreBackdrop')?.addEventListener('click', () => closeMobileMoreSheet());

document.getElementById('mobileMoreLogout')?.addEventListener('click', () => {
    document.getElementById('logoutBtn')?.click();
});

function openSfFabSheet() {
    const backdrop = document.getElementById('sfFabBackdrop');
    const sheet = document.getElementById('sfFabSheet');
    if (!backdrop || !sheet) return;
    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    sheet.hidden = false;
    document.body.classList.add('sf-fab-open');
}

function closeSfFabSheet() {
    const backdrop = document.getElementById('sfFabBackdrop');
    const sheet = document.getElementById('sfFabSheet');
    if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute('aria-hidden', 'true');
    }
    if (sheet) sheet.hidden = true;
    document.body.classList.remove('sf-fab-open');
}

document.getElementById('sfFabBackdrop')?.addEventListener('click', () => closeSfFabSheet());

document.getElementById('sfFabNewQuote')?.addEventListener('click', () => {
    closeSfFabSheet();
    window.location.href = 'quote-builder.html';
});
document.getElementById('sfFabQuickQuote')?.addEventListener('click', () => {
    closeSfFabSheet();
    window.location.href = 'onsite-quote.html';
});
document.getElementById('sfFabNewClient')?.addEventListener('click', () => {
    closeSfFabSheet();
    showPage('customers');
    if (typeof showNewCustomerModal === 'function') showNewCustomerModal();
});
document.getElementById('sfFabSchedule')?.addEventListener('click', () => {
    closeSfFabSheet();
    showPage('schedule');
});
document.getElementById('sfFabFinance')?.addEventListener('click', () => {
    closeSfFabSheet();
    showPage('financeiro');
});

document.getElementById('sfMobileFab')?.addEventListener('click', () => {
    closeMobileMoreSheet();
    const sheet = document.getElementById('sfFabSheet');
    if (sheet && !sheet.hidden) closeSfFabSheet();
    else openSfFabSheet();
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const fabSheet = document.getElementById('sfFabSheet');
    if (fabSheet && !fabSheet.hidden) {
        closeSfFabSheet();
        return;
    }
    const sheet = document.getElementById('mobileMoreSheet');
    if (sheet && !sheet.hidden) closeMobileMoreSheet();
});

// Navigation (só links da sidebar — nunca misturar com .nav-item noutros blocos)
const dashboardSidebarEl = document.getElementById('dashboardSidebar');
if (dashboardSidebarEl) {
    dashboardSidebarEl.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const href = (item.getAttribute('href') || '').trim();
            /* Folha obra e outros links reais (.html) — não interceptar */
            if (href && href !== '#' && !href.startsWith('#')) {
                return;
            }
            e.preventDefault();
            const page = item.dataset.page;
            if (page) showPage(page);
        });
    });
}

function showPage(pageName) {
    if (!pageName || typeof pageName !== 'string') return;

    const contentRoot = document.querySelector('.dashboard-main .dashboard-content');
    if (contentRoot) {
        contentRoot.querySelectorAll(':scope > .page-content').forEach((p) => {
            p.style.display = 'none';
        });
    } else {
        document.querySelectorAll('.dashboard-main .page-content').forEach((p) => {
            p.style.display = 'none';
        });
    }

    const side = document.getElementById('dashboardSidebar');
    if (side) {
        side.querySelectorAll('.sidebar-nav .nav-item').forEach((n) => n.classList.remove('active'));
    }

    const pageEl = document.getElementById(pageName + 'Page');
    if (pageEl) {
        pageEl.style.display = 'block';
        const navLink = side && pageName ? side.querySelector(`[data-page="${pageName}"]`) : null;
        if (navLink) navLink.classList.add('active');
        currentPageName = pageName;
        
        // Load page data
        if (pageName === 'dashboard') loadDashboard();
        else if (pageName === 'marketing') {
            if (typeof initMarketingPage === 'function') initMarketingPage();
            if (typeof loadMarketingDashboard === 'function') loadMarketingDashboard();
        }
        else if (pageName === 'leads') { 
            currentPage = 1; 
            loadLeads(); 
        }
        else if (pageName === 'crm') { 
            currentPage = 1; 
            if (typeof loadCRMKanban === 'function') {
                loadCRMKanban();
            } else {
                // Fallback: load kanban directly
                setTimeout(() => {
                    if (typeof loadKanbanBoard === 'function') {
                        loadKanbanBoard();
                    }
                }, 100);
            }
        }
        else if (pageName === 'customers') { currentPage = 1; loadCustomers(); }
        else if (pageName === 'quotes') {
            currentPage = 1;
            if (typeof updateQuotesFilterChipStyles === 'function') updateQuotesFilterChipStyles();
            loadQuotes();
        }
        else if (pageName === 'projects') { currentPage = 1; loadProjects(); }
        else if (pageName === 'schedule') { 
            currentPage = 1; 
            if (typeof loadScheduleData === 'function') {
                loadScheduleData();
            } else {
                loadVisits(); // Fallback to old visits
            }
        }
        else if (pageName === 'financeiro') { 
            currentPage = 1; 
            if (typeof showFinancialView === 'function') {
                showFinancialView('dashboard');
            } else {
                loadContracts(); // Fallback
            }
        }
        else if (pageName === 'activities') { currentPage = 1; loadActivities(); }
        else if (pageName === 'users') { currentPage = 1; loadUsers(); }

        syncMobileAppChrome(pageName);
        if (isMobile()) setMobileMenuOpen(false);
    }
}

// Dashboard
async function loadDashboard() {
    try {
        const response = await fetch('/api/dashboard/stats', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success) {
            dashboardStats = data.data;
            renderDashboardStats();
        }
    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

function renderDashboardStats() {
    if (!dashboardStats) return;
    
    const stats = dashboardStats;
    const ctr = stats.contracts || {};
    const contractsOnly =
        ctr.contracts_revenue != null ? Number(ctr.contracts_revenue) || 0 : Number(ctr.total_revenue) || 0;
    const wonQuotesOrphan = Number(ctr.won_quotes_revenue) || 0;
    const revenueTotal =
        ctr.total_revenue != null ? Number(ctr.total_revenue) || 0 : contractsOnly + wonQuotesOrphan;
    const revenueMonth = Number(ctr.this_month_revenue) || 0;

    const statsHtml = `
        <div class="stat-card">
            <h3>Leads</h3>
            <div class="stat-value">${stats.leads.total}</div>
            <div class="stat-details">
                <span>New: ${stats.leads.new_leads}</span>
                <span>Today: ${stats.leads.today}</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Clients</h3>
            <div class="stat-value">${stats.customers.total}</div>
            <div class="stat-details">
                <span>Active: ${stats.customers.active}</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Quotes</h3>
            <div class="stat-value">${stats.quotes.total}</div>
            <div class="stat-details">
                <span>Value: $${parseFloat(stats.quotes.total_value || 0).toLocaleString()}</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Projects</h3>
            <div class="stat-value">${stats.projects.total}</div>
            <div class="stat-details">
                <span>In Progress: ${stats.projects.in_progress}</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Receita (CRM)</h3>
            <div class="stat-value">$${revenueTotal.toLocaleString()}</div>
            <div class="stat-details">
                <span>Contratos: $${contractsOnly.toLocaleString()}</span>
                <span>Ganhos s/ contrato (aprovado ou lead Fechado-Ganhou): $${wonQuotesOrphan.toLocaleString()}</span>
                <span>Últ. 30 dias: $${revenueMonth.toLocaleString()}</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Visits</h3>
            <div class="stat-value">${stats.visits.scheduled}</div>
            <div class="stat-details">
                <span>Today: ${stats.visits.today}</span>
                <span>This Week: ${stats.visits.this_week}</span>
            </div>
        </div>
    `;
    
    document.getElementById('dashboardStats').innerHTML = statsHtml;
    
    // Banner: leads novos (urgência 30 min)
    const urgentCount = stats.new_leads_urgent_count || 0;
    const bannerEl = document.getElementById('urgentLeadsBanner');
    const bannerText = document.getElementById('urgentLeadsBannerText');
    if (bannerEl && bannerText) {
        if (urgentCount > 0) {
            bannerText.textContent = '⚠️ Você tem ' + urgentCount + ' lead(s) novo(s). Contate em até 30 minutos!';
            bannerEl.style.display = 'flex';
        } else {
            bannerEl.style.display = 'none';
        }
    }
    
    // Render charts
    renderCharts(stats);
    
    // Recent leads (com badge de urgência para novos)
    const urgentIds = (stats.new_leads_urgent || []).reduce((acc, l) => { acc[l.id] = l.created_at; return acc; }, {});
    function minutesRemaining(createdAt) {
        if (!createdAt) return 0;
        const end = new Date(new Date(createdAt).getTime() + 30 * 60000);
        const min = Math.max(0, Math.ceil((end - new Date()) / 60000));
        return min;
    }
    const recentLeadsHtml = stats.recent_leads && stats.recent_leads.length > 0
        ? stats.recent_leads.map(l => {
            const isNew = urgentIds[l.id];
            const minLeft = isNew ? minutesRemaining(l.created_at) : 0;
            const badge = isNew && minLeft > 0 ? '<span class="badge-urgent-new">Novo – ' + minLeft + ' min</span>' : '';
            return `
            <div style="padding: 12px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div>
                        <strong style="color: var(--text-dark);">${l.name || 'Unknown'}</strong> ${badge}<br>
                        <small style="color: var(--text-muted);">${l.email || ''}</small><br>
                        <span class="badge badge-info" style="margin-top: 4px; display: inline-block;">${l.status || 'new'}</span>
                    </div>
                    <small style="color: var(--text-muted);">${new Date(l.created_at).toLocaleDateString()}</small>
                </div>
            </div>
        `;
        }).join('')
        : '<div class="empty-state"><div class="empty-state-icon">L</div><p>No recent leads</p></div>';
    document.getElementById('recentLeads').innerHTML = recentLeadsHtml;
    
    // Upcoming visits
    const visitsHtml = stats.upcoming_visits && stats.upcoming_visits.length > 0
        ? stats.upcoming_visits.map(v => `
            <div style="padding: 12px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div>
                        <strong style="color: var(--text-dark);">${v.lead_name || v.customer_name || 'Unknown'}</strong><br>
                        <small style="color: var(--text-muted);">${new Date(v.scheduled_at).toLocaleString()}</small><br>
                        <span class="badge badge-success" style="margin-top: 4px; display: inline-block;">${v.status || 'scheduled'}</span>
                    </div>
                </div>
            </div>
        `).join('')
        : '<div class="empty-state"><div class="empty-state-icon">S</div><p>No upcoming visits</p></div>';
    document.getElementById('upcomingVisits').innerHTML = visitsHtml;

    renderSfMobileDashboardBlocks();
    loadSfMobileRecentQuotes();
}

function renderSfMobileDashboardBlocks() {
    if (!dashboardStats) return;
    const stats = dashboardStats;
    const greetingEl = document.getElementById('sfMobileGreeting');
    const nameEl = document.getElementById('sidebarUserName');
    const name = nameEl ? String(nameEl.textContent || '').trim() : '';
    const h = new Date().getHours();
    let g = 'Bom dia';
    if (h >= 12 && h < 18) g = 'Boa tarde';
    else if (h >= 18) g = 'Boa noite';
    if (greetingEl) {
        greetingEl.textContent = name ? `${g}, ${name}` : g;
        greetingEl.style.color = 'var(--sf-text-accent, #c8a96e)';
    }

    const ctr = stats.contracts || {};
    const revenueMonth = Number(ctr.this_month_revenue) || 0;
    const q = stats.quotes || {};
    const openQuotes = (Number(q.draft) || 0) + (Number(q.sent) || 0);
    const proj = stats.projects || {};
    const activeProj = Number(proj.in_progress) || 0;
    const leads = stats.leads || {};
    const totalLeads = Number(leads.total) || 0;
    const converted = Number(leads.converted) || 0;
    const convPct = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) + '%' : '—';

    const rm = revenueMonth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const kpiGrid = document.getElementById('sfMobileKpiGrid');
    if (kpiGrid) {
        kpiGrid.innerHTML = `
            <div class="sf-kpi-card touchable">
                <div class="sf-kpi-card__value">$${rm}</div>
                <div class="sf-kpi-card__label">Faturamento mês</div>
            </div>
            <div class="sf-kpi-card touchable">
                <div class="sf-kpi-card__value">${openQuotes}</div>
                <div class="sf-kpi-card__label">Quotes em aberto</div>
            </div>
            <div class="sf-kpi-card touchable">
                <div class="sf-kpi-card__value">${activeProj}</div>
                <div class="sf-kpi-card__label">Projetos ativos</div>
            </div>
            <div class="sf-kpi-card touchable">
                <div class="sf-kpi-card__value">${convPct}</div>
                <div class="sf-kpi-card__label">Conversão leads</div>
            </div>`;
    }

    const qa = document.getElementById('sfMobileQuickActions');
    if (qa) {
        qa.innerHTML = `
            <button type="button" class="sf-quick-pill touchable" data-crm-permission="quotes.edit" onclick="location.href='quote-builder.html'"><span aria-hidden="true">📋</span> + Quote</button>
            <button type="button" class="sf-quick-pill touchable" data-crm-permission="customers.create" onclick="showPage('customers'); showNewCustomerModal();"><span aria-hidden="true">👤</span> + Cliente</button>
            <button type="button" class="sf-quick-pill touchable" data-crm-permission="visits.view" onclick="showPage('schedule')"><span aria-hidden="true">📅</span> Ver agenda</button>
            <button type="button" class="sf-quick-pill touchable" data-crm-permission="contracts.view" onclick="showPage('financeiro')"><span aria-hidden="true">💰</span> Financeiro</button>`;
        if (typeof applyCrmNavPermissions === 'function') {
            applyCrmNavPermissions(crmUserPermissions, crmUserRole);
        }
    }

    const act = document.getElementById('sfMobileActivityChips');
    if (act) {
        const chips = [];
        (stats.new_leads_urgent || []).slice(0, 6).forEach((l) => {
            const nm = escapeHtmlCrm(l.name || 'Lead');
            chips.push(
                `<button type="button" class="sf-quick-pill touchable" onclick="showPage('leads')"><span aria-hidden="true">⚡</span> ${nm}</button>`
            );
        });
        (stats.upcoming_visits || []).slice(0, 6).forEach((v) => {
            const label = escapeHtmlCrm(v.lead_name || v.customer_name || v.project_name || 'Visita');
            chips.push(
                `<button type="button" class="sf-quick-pill touchable" onclick="showPage('schedule')"><span aria-hidden="true">📍</span> ${label}</button>`
            );
        });
        act.innerHTML =
            chips.length > 0
                ? chips.join('')
                : '<span class="sf-caption" style="padding:8px 0;">Sem pendências urgentes na agenda</span>';
    }
}

async function loadSfMobileRecentQuotes() {
    const host = document.getElementById('sfMobileRecentQuotes');
    if (!host) return;
    host.innerHTML = sfQuotesMobileSkeleton(3);
    try {
        const r = await fetch('/api/quotes?page=1&limit=5', { credentials: 'include' });
        const d = await r.json();
        if (!d.success || !Array.isArray(d.data)) {
            host.innerHTML = '<p class="sf-caption">Não foi possível carregar orçamentos recentes.</p>';
            return;
        }
        if (d.data.length === 0) {
            host.innerHTML = sfQuotesMobileEmptyHtml();
            if (typeof applyCrmNavPermissions === 'function') {
                applyCrmNavPermissions(crmUserPermissions, crmUserRole);
            }
            return;
        }
        const canDeleteQuote =
            crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.edit'));
        host.innerHTML = d.data.map((q) => quoteMobileCardHtml(q, { canDelete: canDeleteQuote })).join('');
        bindSfQuoteCardInteractions(host);
        if (typeof applyCrmNavPermissions === 'function') {
            applyCrmNavPermissions(crmUserPermissions, crmUserRole);
        }
    } catch (e) {
        host.innerHTML = '<p class="sf-caption">Erro ao carregar orçamentos recentes.</p>';
    }
}

function renderCharts(stats) {
    // Destroy existing charts
    Object.values(chartInstances).forEach(chart => {
        if (chart) chart.destroy();
    });
    chartInstances = {};
    
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded');
        return;
    }
    
    const chartColors = {
        primary: '#1a2036',
        secondary: '#d6b598',
        success: '#48bb78',
        warning: '#ed8936',
        error: '#f56565',
        info: '#4299e1'
    };
    
    // Leads by Status Chart
    const leadsStatusCtx = document.getElementById('leadsStatusChart');
    if (leadsStatusCtx) {
        chartInstances.leadsStatus = new Chart(leadsStatusCtx, {
            type: 'doughnut',
            data: {
                labels: ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'],
                datasets: [{
                    data: [
                        stats.leads.new_leads || 0,
                        stats.leads.contacted || 0,
                        stats.leads.qualified || 0,
                        stats.leads.converted || 0,
                        stats.leads.lost || 0
                    ],
                    backgroundColor: [
                        chartColors.info,
                        chartColors.warning,
                        chartColors.secondary,
                        chartColors.success,
                        chartColors.error
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }
    
    // Leads Monthly Chart (últimos 12 meses — dados reais da API)
    const leadsMonthlyCtx = document.getElementById('leadsMonthlyChart');
    if (leadsMonthlyCtx) {
        const monthShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const keys = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const byYm = {};
        (stats.leads_by_month || []).forEach((row) => {
            if (row && row.ym) byYm[String(row.ym).slice(0, 7)] = parseInt(row.cnt, 10) || 0;
        });
        const monthlyData = keys.map((k) => byYm[k] || 0);
        const labels = keys.map((k) => {
            const [y, m] = k.split('-').map(Number);
            return `${monthShort[m - 1]} ${y}`;
        });

        chartInstances.leadsMonthly = new Chart(leadsMonthlyCtx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Leads criados',
                    data: monthlyData,
                    borderColor: chartColors.primary,
                    backgroundColor: chartColors.primary + '20',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                }
            }
        });
    }
    
    // Receita: contratos + orçamentos aprovados/aceites sem contrato; total e janela 30 dias
    const revenueCtx = document.getElementById('revenueChart');
    if (revenueCtx) {
        const ctrChart = stats.contracts || {};
        const cRev = ctrChart.contracts_revenue != null ? Number(ctrChart.contracts_revenue) || 0 : Number(ctrChart.total_revenue) || 0;
        const wRev = Number(ctrChart.won_quotes_revenue) || 0;
        const tRev =
            ctrChart.total_revenue != null ? Number(ctrChart.total_revenue) || 0 : cRev + wRev;
        const mRev = Number(ctrChart.this_month_revenue) || 0;
        chartInstances.revenue = new Chart(revenueCtx, {
            type: 'bar',
            data: {
                labels: ['Contratos (fechado)', 'Orç. aprov./aceite (s/ contrato)', 'Receita total CRM', 'Últ. 30 dias'],
                datasets: [{
                    label: 'Valor ($)',
                    data: [cRev, wRev, tRev, mRev],
                    backgroundColor: [
                        chartColors.success,
                        chartColors.secondary,
                        chartColors.primary,
                        chartColors.info
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                const v = ctx.raw;
                                return typeof v === 'number' ? '$' + v.toLocaleString() : String(v);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Valor de orçamentos aprovados/aceites por vendedor (quotes.assigned_to)
    const salesPerformanceCtx = document.getElementById('salesPerformanceChart');
    if (salesPerformanceCtx) {
        const reps = stats.sales_by_rep || [];
        const repLabels = reps.length
            ? reps.map((r) => String(r.rep_name || '—').slice(0, 22))
            : ['Sem dados'];
        const repAmounts = reps.length ? reps.map((r) => parseFloat(r.won_amount) || 0) : [0];
        chartInstances.salesPerformance = new Chart(salesPerformanceCtx, {
            type: 'bar',
            data: {
                labels: repLabels,
                datasets: [{
                    label: 'Orç. aprov./aceite ($)',
                    data: repAmounts,
                    backgroundColor: chartColors.secondary
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                const v = ctx.raw;
                                const i = ctx.dataIndex;
                                const row = reps[i];
                                const n = row ? parseInt(row.won_count, 10) || 0 : 0;
                                const money = typeof v === 'number' ? '$' + v.toLocaleString() : String(v);
                                return reps.length ? `${money} (${n} orç.)` : money;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }
}

// Leads
let leadsPage = 1;
const LEADS_PAGE_LIMIT = 50;
/** Filtro de texto na lista (nome, email, telefone, ID) — alinhado ao Kanban */
let leadsListSearch = '';

function leadsSearchSubmit() {
    const el = document.getElementById('leadsListSearchInput');
    leadsListSearch = el ? el.value.trim() : '';
    leadsPage = 1;
    loadLeads();
}

function leadsSearchClear() {
    const el = document.getElementById('leadsListSearchInput');
    if (el) el.value = '';
    leadsListSearch = '';
    leadsPage = 1;
    loadLeads();
}

async function loadLeads() {
    const tbody = document.getElementById('leadsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">Loading...</td></tr>';
    }
    
    try {
        await ensureLeadsPipelineColorMap();
        const qParam = leadsListSearch ? `&q=${encodeURIComponent(leadsListSearch)}` : '';
        const response = await fetch(
            `/api/leads?page=${leadsPage}&limit=${LEADS_PAGE_LIMIT}${qParam}`,
            { credentials: 'include' }
        );
        const data = await response.json();
        
        if (data.success && data.data) {
            if (tbody) {
                if (data.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="9" class="text-center">No leads found</td></tr>';
                } else {
                    function isLeadUrgentNew(createdAt) {
                        if (!createdAt) return 0;
                        var end = new Date(new Date(createdAt).getTime() + 30 * 60000);
                        return Math.max(0, Math.ceil((end - new Date()) / 60000));
                    }
                    tbody.innerHTML = data.data.map(lead => {
                        var minLeft = isLeadUrgentNew(lead.created_at);
                        var urgentBadge = minLeft > 0 ? ' <span class="badge-urgent-new">Novo – ' + minLeft + ' min</span>' : '';
                        var stageColor = resolveLeadRowStageColor(lead);
                        var statusSlug = lead.status || 'new';
                        var statusLabel =
                            (lead.pipeline_stage_name && String(lead.pipeline_stage_name).trim()) ||
                            statusSlug.replace(/_/g, ' ');
                        return `<tr class="lead-table-row" style="--lead-stage-color: ${stageColor}">
                            <td>${lead.id}</td>
                            <td>${lead.name || '-'}${urgentBadge}</td>
                            <td>${lead.email || '-'}</td>
                            <td>${lead.phone || '-'}</td>
                            <td>${lead.zipcode || '-'}</td>
                            <td><span class="lead-status-pipeline" title="${escapeHtmlLeadList(statusLabel)}"><span class="lead-stage-color-dot" style="background-color: ${stageColor}" aria-hidden="true"></span><span class="badge badge-${statusSlug}">${escapeHtmlLeadList(statusLabel)}</span></span></td>
                            <td>${lead.source || '-'}</td>
                            <td>${lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '-'}</td>
                            <td>
                                <button class="btn btn-sm" onclick="viewLead(${lead.id})" title="Ver"><span class="action-btn-icon">V</span></button>
                                <button class="btn btn-sm" onclick="showAssignLeadModal(${lead.id})" title="Designar"><span class="action-btn-icon">U</span></button>
                                <button class="btn btn-sm" onclick="showFollowupModal(${lead.id})" title="Follow-up"><span class="action-btn-icon">D</span></button>
                                <button class="btn btn-sm btn-lead-delete" onclick="deleteLead(${lead.id})" title="Excluir">✕</button>
                            </td>
                        </tr>`;
                    }).join('');
                }
            }
            
            const totalPages = Math.ceil(data.total / LEADS_PAGE_LIMIT);
            const pageInfo = document.getElementById('pageInfoLeads');
            if (pageInfo) pageInfo.textContent = `Page ${leadsPage} of ${totalPages || 1}`;
            const prevBtn = document.getElementById('prevPageLeads');
            if (prevBtn) prevBtn.disabled = leadsPage <= 1;
            const nextBtn = document.getElementById('nextPageLeads');
            if (nextBtn) nextBtn.disabled = leadsPage >= totalPages;
        }
    } catch (error) {
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">Error: ' + error.message + '</td></tr>';
        }
    }
}

function changePageLeads(delta) {
    leadsPage += delta;
    if (leadsPage < 1) leadsPage = 1;
    loadLeads();
}

function refreshLeads() {
    leadsPage = 1;
    leadsPipelineSlugToColor = null;
    loadLeads();
}

function viewLead(id) {
    window.location.href = `lead-detail.html?id=${id}`;
}

async function deleteLead(id) {
    if (!id || !confirm('Excluir este lead permanentemente? Esta ação não pode ser desfeita.')) return;
    try {
        const r = await fetch(`/api/leads/${id}`, { method: 'DELETE', credentials: 'include' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success) {
            if (typeof crmNotify === 'function') crmNotify(d.error || 'Não foi possível excluir o lead.', 'error');
            else alert(d.error || 'Não foi possível excluir o lead.');
            return;
        }
        if (currentPageName === 'leads' && typeof loadLeads === 'function') loadLeads();
        else if (currentPageName === 'crm') {
            if (typeof loadCRMKanban === 'function') loadCRMKanban();
            else if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
        }
    } catch (e) {
        if (typeof crmNotify === 'function') crmNotify('Erro de rede ao excluir.', 'error');
        else alert('Erro de rede ao excluir.');
    }
}

// Make functions globally available
window.viewLead = viewLead;
window.deleteLead = deleteLead;
window.deleteQuote = deleteQuote;
window.leadsSearchSubmit = leadsSearchSubmit;
window.leadsSearchClear = leadsSearchClear;

// Clients (/api/customers)
let customersPage = 1;

function escapeClientCell(s) {
    if (s == null || s === '') return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

/** Até 10 dígitos → (XXX) XXX-XXXX */
function formatUsPhoneMaskFromDigits(raw) {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 10);
    if (d.length === 0) return '';
    if (d.length <= 3) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function displayPhoneInClientForm(phone) {
    if (phone == null || phone === '') return '';
    const s = String(phone).trim();
    if (s === '—' || s === '-' || /^n\/?a$/i.test(s)) return '';
    let d = s.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    if (d.length === 10) return formatUsPhoneMaskFromDigits(d);
    return s;
}

async function loadCustomers() {
    const tbody = document.getElementById('customersTableBody');
    tbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/customers?page=${customersPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" class="text-center">No clients found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(c => {
                    const leadCell =
                        c.lead_id != null && c.lead_id !== ''
                            ? `<a href="lead-detail.html?id=${encodeURIComponent(c.lead_id)}">#${c.lead_id}</a>`
                            : '—';
                    const nameCell =
                        c.customer_type === 'builder' && c.responsible_name
                            ? `${escapeClientCell(c.name) || '-'} · ${escapeClientCell(c.responsible_name)}`
                            : escapeClientCell(c.name) || '-';
                    return `
                    <tr>
                        <td>${c.id}</td>
                        <td>${nameCell}</td>
                        <td>${escapeClientCell(c.email) || '-'}</td>
                        <td>${escapeClientCell(c.phone) || '-'}</td>
                        <td>${escapeClientCell(c.city) || '-'}</td>
                        <td>${escapeClientCell(c.customer_type) || '-'}</td>
                        <td>${leadCell}</td>
                        <td><span class="badge badge-${c.status || 'active'}">${c.status || 'active'}</span></td>
                        <td>${c.created_at ? new Date(c.created_at).toLocaleDateString() : '-'}</td>
                        <td><button type="button" class="btn btn-sm" onclick="viewCustomer(${c.id})">Edit</button></td>
                    </tr>`;
                }).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoCustomers').textContent = `Page ${customersPage} of ${totalPages || 1}`;
            document.getElementById('prevPageCustomers').disabled = customersPage <= 1;
            document.getElementById('nextPageCustomers').disabled = customersPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">Error: ' + escapeClientCell(error.message) + '</td></tr>';
    }
}

function changePageCustomers(delta) {
    customersPage += delta;
    if (customersPage < 1) customersPage = 1;
    loadCustomers();
}

function syncClientFormBuilderFields() {
    const typeEl = document.getElementById('clientType');
    const nonRow = document.getElementById('clientNonBuilderNameRow');
    const bRow = document.getElementById('clientBuilderNameRow');
    const nameInp = document.getElementById('clientName');
    const compInp = document.getElementById('clientCompanyName');
    const respInp = document.getElementById('clientResponsibleName');
    if (!typeEl || !nonRow || !bRow) return;
    const isBuilder = typeEl.value === 'builder';
    nonRow.style.display = isBuilder ? 'none' : '';
    bRow.style.display = isBuilder ? '' : 'none';
    if (nameInp) {
        nameInp.required = !isBuilder;
        if (isBuilder) nameInp.removeAttribute('required');
    }
    if (compInp) compInp.required = isBuilder;
    if (respInp) respInp.required = isBuilder;
}

function resetClientForm() {
    const ids = [
        'clientFormId',
        'clientFormLeadId',
        'clientName',
        'clientCompanyName',
        'clientResponsibleName',
        'clientEmail',
        'clientPhone',
        'clientAddress',
        'clientCity',
        'clientState',
        'clientZip',
        'clientNotes',
        'clientFormError',
    ];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'clientFormError') {
            el.textContent = '';
            el.style.display = 'none';
        } else el.value = '';
    });
    const typeEl = document.getElementById('clientType');
    if (typeEl) typeEl.value = 'residential';
    const st = document.getElementById('clientStatus');
    if (st) st.value = 'active';
    syncClientFormBuilderFields();
}

function showNewCustomerModal() {
    resetClientForm();
    const t = document.getElementById('clientModalTitle');
    if (t) t.textContent = 'Novo cliente';
    const modal = document.getElementById('clientModal');
    if (modal) modal.style.display = 'flex';
}

async function viewCustomer(id) {
    resetClientForm();
    const t = document.getElementById('clientModalTitle');
    if (t) t.textContent = 'Editar cliente';
    const err = document.getElementById('clientFormError');
    try {
        const res = await fetch(`/api/customers/${id}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success || !data.data) {
            if (err) {
                err.textContent = data.error || 'Não foi possível carregar o cliente';
                err.style.display = 'block';
            }
            return;
        }
        const c = data.data;
        const set = (fid, v) => {
            const el = document.getElementById(fid);
            if (el) el.value = v != null && v !== '' ? String(v) : '';
        };
        document.getElementById('clientFormId').value = String(c.id);
        set('clientFormLeadId', c.lead_id != null ? c.lead_id : '');
        const isB = (c.customer_type || 'residential') === 'builder';
        set('clientName', isB ? '' : c.name);
        set('clientCompanyName', isB ? c.name : '');
        set('clientResponsibleName', isB && c.responsible_name != null ? c.responsible_name : '');
        set('clientEmail', c.email);
        set('clientPhone', displayPhoneInClientForm(c.phone));
        set('clientAddress', c.address);
        set('clientCity', c.city);
        set('clientState', c.state);
        set('clientZip', c.zipcode);
        set('clientType', c.customer_type || 'residential');
        set('clientStatus', c.status || 'active');
        set('clientNotes', c.notes);
        syncClientFormBuilderFields();
        const modal = document.getElementById('clientModal');
        if (modal) modal.style.display = 'flex';
    } catch (e) {
        if (err) {
            err.textContent = e.message || 'Erro de rede';
            err.style.display = 'block';
        }
    }
}

async function submitClientForm(ev) {
    ev.preventDefault();
    const errEl = document.getElementById('clientFormError');
    if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
    }
    const id = document.getElementById('clientFormId').value.trim();
    const ctype = document.getElementById('clientType').value;
    let nameVal;
    let responsibleVal = null;
    if (ctype === 'builder') {
        nameVal = document.getElementById('clientCompanyName').value.trim();
        responsibleVal = document.getElementById('clientResponsibleName').value.trim();
        if (nameVal.length < 2) {
            if (errEl) {
                errEl.textContent = 'Indique o nome da empresa (Builder).';
                errEl.style.display = 'block';
            }
            return;
        }
        if (responsibleVal.length < 2) {
            if (errEl) {
                errEl.textContent = 'Indique o responsável (pessoa de contacto).';
                errEl.style.display = 'block';
            }
            return;
        }
    } else {
        nameVal = document.getElementById('clientName').value.trim();
    }
    const body = {
        name: nameVal,
        email: document.getElementById('clientEmail').value.trim(),
        phone: document.getElementById('clientPhone').value.trim(),
        address: document.getElementById('clientAddress').value.trim() || null,
        city: document.getElementById('clientCity').value.trim() || null,
        state: document.getElementById('clientState').value.trim() || null,
        zipcode: document.getElementById('clientZip').value.replace(/\D/g, '').slice(0, 10) || null,
        customer_type: ctype,
        notes: document.getElementById('clientNotes').value.trim() || null,
    };
    if (ctype === 'builder') body.responsible_name = responsibleVal;
    else body.responsible_name = null;
    const leadRaw = document.getElementById('clientFormLeadId').value.trim();
    if (leadRaw && !id) body.lead_id = parseInt(leadRaw, 10);

    if (id) {
        body.status = document.getElementById('clientStatus').value;
    }

    const btn = document.getElementById('clientFormSubmit');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'A guardar…';
    }
    try {
        const url = id ? `/api/customers/${encodeURIComponent(id)}` : '/api/customers';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (errEl) {
                errEl.textContent = data.error || 'Pedido falhou (HTTP ' + res.status + ')';
                errEl.style.display = 'block';
            }
            return;
        }
        if (typeof closeModal === 'function') closeModal('clientModal');
        loadCustomers();
    } catch (e) {
        if (errEl) {
            errEl.textContent = e.message || 'Erro de rede';
            errEl.style.display = 'block';
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Guardar';
        }
    }
}

window.viewCustomer = viewCustomer;
window.showNewCustomerModal = showNewCustomerModal;
window.submitClientForm = submitClientForm;

// Quotes (pagination: não usar nome "quotesPage" — colide com id DOM #quotesPage e quebrava showPage)
let quotesListPage = 1;
let quotesListFilter = 'all';

function updateQuotesFilterChipStyles() {
    document.querySelectorAll('.quotes-filter-chip').forEach((b) => {
        b.classList.toggle('quotes-filter-chip--active', b.getAttribute('data-quotes-filter') === quotesListFilter);
    });
}

function setQuotesFilter(f) {
    quotesListFilter = f && typeof f === 'string' ? f : 'all';
    quotesListPage = 1;
    updateQuotesFilterChipStyles();
    loadQuotes();
}
window.setQuotesFilter = setQuotesFilter;

function quoteStatusSfBadgeHtml(status) {
    const raw = String(status || 'draft').toLowerCase();
    let slug = raw.replace(/[^a-z0-9_-]/g, '') || 'draft';
    if (slug === 'accepted') slug = 'accepted';
    const labels = {
        draft: 'Rascunho',
        sent: 'Enviado',
        viewed: 'Visto',
        approved: 'Aprovado',
        accepted: 'Aceite',
        rejected: 'Rejeitado',
        declined: 'Recusado',
        expired: 'Expirado',
    };
    const label = labels[slug] || escapeHtmlCrm(status || 'draft');
    return `<span class="sf-quote-badge sf-quote-badge--${slug}">${label}</span>`;
}

function sfQuotesMobileSkeleton(count) {
    const n = Math.max(1, Math.min(8, count | 0));
    let html = '';
    for (let i = 0; i < n; i++) {
        html += '<div class="sf-quote-card"><div class="skeleton" style="height:72px;width:100%;border-radius:12px"></div></div>';
    }
    return html;
}

function sfQuotesMobileEmptyHtml() {
    return `<div class="ds-empty-state" role="status">
<h3 class="ds-empty-state__title">Nenhum orçamento ainda</h3>
<p class="ds-empty-state__text">Crie o primeiro orçamento tocando no +</p>
<button type="button" class="btn btn-primary touchable" data-crm-permission="quotes.edit" onclick="location.href='quote-builder.html'">+ Novo orçamento</button>
</div>`;
}

function quoteMobileCardHtml(q, opts) {
    const canDelete = opts && opts.canDelete;
    const clientLabel = escapeHtmlCrm(q.customer_name || q.lead_name || '—');
    const qnum = escapeHtmlCrm(q.quote_number != null ? String(q.quote_number) : 'N/A');
    const amt = parseFloat(q.total_amount || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const id = Number(q.id);
    const delBtn = canDelete
        ? `<button type="button" class="sf-quote-card__action-btn sf-quote-card__action-btn--del touchable" onclick="event.stopPropagation(); deleteQuote(${id})">Apagar</button>`
        : '';
    const editBtn = `<button type="button" class="sf-quote-card__action-btn sf-quote-card__action-btn--edit touchable" onclick="event.stopPropagation(); viewQuote(${id})">Editar</button>`;
    return `
    <article class="sf-quote-card touchable" data-quote-id="${id}" role="button" tabindex="0">
      <div class="sf-quote-card__inner">
        <div class="sf-quote-card__row">
          <div>
            <div class="sf-quote-card__client">${clientLabel}</div>
            <div class="sf-quote-card__meta">Quote #${qnum}</div>
          </div>
          <div class="sf-quote-card__amt">$${amt}</div>
        </div>
        ${quoteStatusSfBadgeHtml(q.status)}
      </div>
      <div class="sf-quote-card__actions">${editBtn}${delBtn}</div>
    </article>`;
}

function getQuotesMobileFilteredRows() {
    const input = document.getElementById('quotesMobileSearch');
    const q = (input && input.value) || '';
    const needle = String(q).trim().toLowerCase();
    if (!needle) return sfQuotesListCache.slice();
    return sfQuotesListCache.filter((row) => {
        const c = String(row.customer_name || row.lead_name || '').toLowerCase();
        const n = String(row.quote_number != null ? row.quote_number : '').toLowerCase();
        return c.includes(needle) || n.includes(needle);
    });
}

function bindSfQuoteCardInteractions(container) {
    if (!container || container.dataset.sfSwipeBound === '1') return;
    container.dataset.sfSwipeBound = '1';
    let activeCard = null;
    let startX = 0;

    container.addEventListener(
        'touchstart',
        (e) => {
            const card = e.target.closest('.sf-quote-card');
            if (!card || e.target.closest('button')) return;
            activeCard = card;
            startX = e.touches[0].clientX;
        },
        { passive: true }
    );

    container.addEventListener(
        'touchend',
        (e) => {
            if (!activeCard) return;
            const card = activeCard;
            activeCard = null;
            const endX = e.changedTouches[0] ? e.changedTouches[0].clientX : startX;
            const dx = endX - startX;
            if (dx < -120) {
                try {
                    navigator.vibrate(20);
                } catch (err) {}
                card.classList.add('sf-quote-card--open');
                return;
            }
            if (dx < -60) {
                card.classList.add('sf-quote-card--open');
                try {
                    navigator.vibrate(8);
                } catch (err) {}
            } else if (dx > 30) {
                card.classList.remove('sf-quote-card--open');
            }
        },
        { passive: true }
    );

    container.addEventListener('click', (e) => {
        const card = e.target.closest('.sf-quote-card');
        if (!card) return;
        if (e.target.closest('button')) return;
        if (card.classList.contains('sf-quote-card--open')) {
            card.classList.remove('sf-quote-card--open');
            return;
        }
        const id = parseInt(String(card.dataset.quoteId || ''), 10);
        if (Number.isFinite(id) && id > 0) viewQuote(id);
    });
}

function renderQuotesMobileFromCache() {
    const mobileList = document.getElementById('quotesMobileList');
    if (!mobileList || !isMobile()) return;
    const canDeleteQuote =
        crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.edit'));
    const rows = getQuotesMobileFilteredRows();
    if (rows.length === 0) {
        mobileList.innerHTML = sfQuotesMobileEmptyHtml();
        if (typeof applyCrmNavPermissions === 'function') {
            applyCrmNavPermissions(crmUserPermissions, crmUserRole);
        }
        return;
    }
    mobileList.innerHTML = rows.map((q) => quoteMobileCardHtml(q, { canDelete: canDeleteQuote })).join('');
    bindSfQuoteCardInteractions(mobileList);
}

function updateQuotesMobileChrome(total, totalPages) {
    const sub = document.getElementById('quotesMobileSubtitle');
    const btn = document.getElementById('quotesMobileLoadMore');
    if (sub) {
        const t = typeof total === 'number' ? total : 0;
        const tp = Math.max(1, totalPages | 0);
        const p = quotesListPage;
        sub.textContent =
            t === 0
                ? '0 orçamentos'
                : t === 1
                  ? '1 orçamento'
                  : `${t} orçamentos · página ${p} de ${tp}`;
    }
    if (btn) {
        const tp = Math.max(1, totalPages | 0);
        btn.style.display = isMobile() && quotesListPage < tp ? 'inline-block' : 'none';
    }
}

let sfQuotesPtrPulling = false;
let sfQuotesPtrStartY = 0;
let sfQuotesPtrArmed = false;

function initQuotesMobileUx() {
    const search = document.getElementById('quotesMobileSearch');
    if (search && !search.dataset.sfBound) {
        search.dataset.sfBound = '1';
        let t;
        search.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => renderQuotesMobileFromCache(), 140);
        });
    }

    const main = document.querySelector('.dashboard-main');
    const ind = document.getElementById('quotesPtrIndicator');
    if (main && ind && !main.dataset.sfQuotesPtr) {
        main.dataset.sfQuotesPtr = '1';
        main.addEventListener(
            'touchstart',
            (e) => {
                if (currentPageName !== 'quotes' || !isMobile()) return;
                sfQuotesPtrPulling = true;
                sfQuotesPtrStartY = e.touches[0].clientY;
                sfQuotesPtrArmed = main.scrollTop <= 0;
            },
            { passive: true }
        );
        main.addEventListener(
            'touchmove',
            (e) => {
                if (currentPageName !== 'quotes' || !isMobile() || !sfQuotesPtrPulling || !sfQuotesPtrArmed) return;
                if (main.scrollTop > 0) {
                    ind.classList.remove('sf-ptr-visible');
                    return;
                }
                const dy = e.touches[0].clientY - sfQuotesPtrStartY;
                if (dy > 48) {
                    ind.classList.add('sf-ptr-visible');
                    ind.textContent = dy > 88 ? '↓ Largar para atualizar' : '↓ Puxe para atualizar';
                } else {
                    ind.classList.remove('sf-ptr-visible');
                }
            },
            { passive: true }
        );
        main.addEventListener(
            'touchend',
            () => {
                if (currentPageName !== 'quotes' || !isMobile()) return;
                const refresh = ind.classList.contains('sf-ptr-visible');
                ind.classList.remove('sf-ptr-visible');
                sfQuotesPtrPulling = false;
                sfQuotesPtrArmed = false;
                if (refresh && main.scrollTop <= 0) {
                    quotesListPage = 1;
                    try {
                        navigator.vibrate(12);
                    } catch (err) {}
                    loadQuotes();
                }
            },
            { passive: true }
        );
    }

    const lm = document.getElementById('quotesMobileLoadMore');
    if (lm && !lm.dataset.sfBound) {
        lm.dataset.sfBound = '1';
        lm.addEventListener('click', () => changePageQuotes(1));
    }
}

initQuotesMobileUx();

function formatQuoteExpiryHtml(expirationDateStr, status) {
    const st = String(status || '').toLowerCase();
    if (st === 'expired') {
        return '<div class="quotes-expiry quotes-expiry--overdue"><span class="quotes-expiry__rel">Expirado</span><span class="quotes-expiry__date">—</span></div>';
    }
    if (!expirationDateStr) {
        return '<span class="quotes-cell-muted">—</span>';
    }
    const d = new Date(expirationDateStr);
    if (Number.isNaN(d.getTime())) {
        return '<span class="quotes-cell-muted">—</span>';
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const exp = new Date(d);
    exp.setHours(0, 0, 0, 0);
    const diff = Math.round((exp - now) / 86400000);
    let rel = '';
    let cls = 'quotes-expiry';
    if (diff < 0) {
        rel = 'Expirado';
        cls += ' quotes-expiry--overdue';
    } else if (diff === 0) {
        rel = 'Hoje';
        cls += ' quotes-expiry--soon';
    } else if (diff === 1) {
        rel = 'Amanhã';
        cls += ' quotes-expiry--soon';
    } else if (diff <= 7) {
        rel = 'Em ' + diff + ' dias';
        cls += ' quotes-expiry--soon';
    } else {
        rel = 'Em ' + diff + ' dias';
    }
    const dateStr = d.toLocaleDateString();
    return `<div class="${cls}"><span class="quotes-expiry__rel">${rel}</span><span class="quotes-expiry__date">${dateStr}</span></div>`;
}

function quoteStatusBadgeHtml(status) {
    const raw = String(status || 'draft').toLowerCase();
    let slug = raw.replace(/[^a-z0-9_-]/g, '') || 'draft';
    if (slug === 'accepted') slug = 'accepted';
    const labels = {
        draft: 'Rascunho',
        sent: 'Enviado',
        viewed: 'Visto',
        approved: 'Aprovado',
        accepted: 'Aceite',
        rejected: 'Rejeitado',
        declined: 'Recusado',
        expired: 'Expirado',
    };
    const label = labels[slug] || escapeHtmlCrm(status || 'draft');
    return `<span class="badge-quote badge-quote--${slug}">${label}</span>`;
}

function quotesListEmptyStateRowHtml() {
    return `<tr class="ds-empty-row"><td colspan="8">
<div class="ds-empty-state" role="status">
<svg class="ds-empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/><path d="M9 11h6"/></svg>
<h3 class="ds-empty-state__title">Nenhum orçamento encontrado</h3>
<p class="ds-empty-state__text">Crie um orçamento ou altere os filtros acima para ver mais resultados.</p>
<button type="button" class="btn btn-primary" data-crm-permission="quotes.edit" onclick="location.href='quote-builder.html'">+ Novo orçamento</button>
</div></td></tr>`;
}

function crmToastSafe(msg, opts) {
    const t = (opts && opts.type) || 'success';
    if (typeof window.crmNotify === 'function') {
        window.crmNotify(msg, t === 'error' ? 'error' : t === 'info' ? 'info' : 'success');
        return;
    }
    if (window.crmToast && typeof window.crmToast.show === 'function') {
        window.crmToast.show(msg, opts || {});
    } else {
        alert(msg);
    }
}

async function duplicateQuoteFromList(id) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    try {
        const r = await fetch(`/api/quotes/${qid}/duplicate`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) {
            crmToastSafe(d.error || 'Não foi possível duplicar o orçamento.', { type: 'error' });
            return;
        }
        const nid = d.data && d.data.quote && d.data.quote.id;
        if (nid) {
            window.location.href = 'quote-builder.html?id=' + encodeURIComponent(String(nid));
        } else {
            crmToastSafe('Duplicado, mas resposta inválida.', { type: 'error' });
        }
    } catch (e) {
        crmToastSafe(e.message || 'Erro de rede ao duplicar.', { type: 'error' });
    }
}
window.duplicateQuoteFromList = duplicateQuoteFromList;

async function generateQuotePdfFromList(id) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    try {
        const r = await fetch(`/api/quotes/${qid}/generate-pdf`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) {
            crmToastSafe(d.error || 'Não foi possível gerar o PDF.', { type: 'error' });
            return;
        }
        window.open(`/api/quotes/${qid}/invoice-pdf`, '_blank', 'noopener');
        if (typeof loadQuotes === 'function') loadQuotes();
    } catch (e) {
        crmToastSafe(e.message || 'Erro de rede ao gerar PDF.', { type: 'error' });
    }
}
window.generateQuotePdfFromList = generateQuotePdfFromList;

async function loadQuotes() {
    const tbody = document.getElementById('quotesTableBody');
    if (!tbody) return;
    const mobileList = document.getElementById('quotesMobileList');
    const subEl = document.getElementById('quotesListSubtitle');
    if (subEl) subEl.textContent = 'A carregar…';
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">A carregar…</td></tr>';
    if (mobileList && isMobile()) {
        mobileList.innerHTML = sfQuotesMobileSkeleton(5);
    }
    const canDeleteQuote =
        crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.edit'));
    const canDup = crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.create'));
    const canGenPdf = crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.edit'));

    let url = `/api/quotes?page=${quotesListPage}&limit=20`;
    if (quotesListFilter === 'expiring7') {
        url += '&expiring_within_days=7';
    } else if (quotesListFilter !== 'all') {
        url += '&status=' + encodeURIComponent(quotesListFilter);
    }

    try {
        const response = await fetch(url, { credentials: 'include' });
        const data = await response.json();

        if (data.success && data.data) {
            const total = typeof data.total === 'number' ? data.total : data.data.length;
            if (subEl) {
                subEl.textContent =
                    total === 0
                        ? '0 orçamentos'
                        : total === 1
                          ? '1 orçamento'
                          : `${total} orçamentos`;
            }
            if (data.data.length === 0) {
                sfQuotesListCache = [];
                tbody.innerHTML = quotesListEmptyStateRowHtml();
                if (mobileList && isMobile()) {
                    mobileList.innerHTML = sfQuotesMobileEmptyHtml();
                }
                if (typeof applyCrmNavPermissions === 'function') {
                    applyCrmNavPermissions(crmUserPermissions, crmUserRole);
                }
            } else {
                sfQuotesListCache = data.data.slice();
                tbody.innerHTML = data.data
                    .map((q) => {
                        const hasPdf = !!(q.pdf_path || q.has_invoice_pdf);
                        const pdfCell = hasPdf
                            ? `<a class="btn btn-sm" href="/api/quotes/${q.id}/invoice-pdf" target="_blank" rel="noopener">Ver PDF</a>`
                            : canGenPdf
                              ? `<button type="button" class="btn btn-sm btn-secondary" onclick="generateQuotePdfFromList(${q.id})">Gerar PDF</button>`
                              : '<span class="quotes-cell-muted">—</span>';
                        const deleteBtn = canDeleteQuote
                            ? `<button type="button" class="btn btn-sm btn-danger" onclick="deleteQuote(${q.id})" title="Excluir orçamento">Excluir</button>`
                            : '';
                        const dupBtn = canDup
                            ? `<button type="button" class="btn btn-sm btn-secondary" onclick="duplicateQuoteFromList(${q.id})" title="Duplicar">Duplicar</button>`
                            : '';
                        const clientLabel = escapeHtmlCrm(q.customer_name || q.lead_name || '—');
                        const qnum = escapeHtmlCrm(q.quote_number != null ? String(q.quote_number) : 'N/A');
                        const amt = parseFloat(q.total_amount || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        });
                        return `
                    <tr class="quotes-table-row">
                        <td>${qnum}</td>
                        <td>${clientLabel}</td>
                        <td class="tabular-nums">$${amt}</td>
                        <td>${quoteStatusBadgeHtml(q.status)}</td>
                        <td>${pdfCell}</td>
                        <td>${q.created_at ? escapeHtmlCrm(new Date(q.created_at).toLocaleDateString()) : '—'}</td>
                        <td>${formatQuoteExpiryHtml(q.expiration_date, q.status)}</td>
                        <td class="quotes-actions-cell">
                            <button type="button" class="btn btn-sm btn-secondary" onclick="viewQuote(${q.id})" title="Editar orçamento">Abrir</button>
                            ${dupBtn}
                            ${deleteBtn}
                        </td>
                    </tr>`;
                    })
                    .join('');
                if (isMobile()) {
                    renderQuotesMobileFromCache();
                }
            }

            const totalPages = Math.max(1, Math.ceil(total / 20));
            const pageInfoEl = document.getElementById('pageInfoQuotes');
            if (pageInfoEl) {
                pageInfoEl.textContent = `Página ${quotesListPage} de ${totalPages || 1}`;
            }
            const prevQ = document.getElementById('prevPageQuotes');
            const nextQ = document.getElementById('nextPageQuotes');
            if (prevQ) prevQ.disabled = quotesListPage <= 1;
            if (nextQ) nextQ.disabled = quotesListPage >= totalPages;
            updateQuotesMobileChrome(total, totalPages);
        } else {
            if (subEl) subEl.textContent = 'Erro ao carregar';
            tbody.innerHTML =
                '<tr><td colspan="8" class="text-center">Resposta inválida do servidor</td></tr>';
            sfQuotesListCache = [];
            if (mobileList && isMobile()) {
                mobileList.innerHTML =
                    '<p class="sf-caption">Não foi possível carregar os orçamentos.</p>';
            }
        }
    } catch (error) {
        if (subEl) subEl.textContent = 'Erro ao carregar';
        tbody.innerHTML =
            '<tr><td colspan="8" class="text-center">Erro: ' + escapeHtmlCrm(error.message) + '</td></tr>';
        if (mobileList && isMobile()) {
            mobileList.innerHTML =
                '<p class="sf-caption">Erro ao carregar. Tente puxar para atualizar.</p>';
        }
    }
}

function changePageQuotes(delta) {
    quotesListPage += delta;
    if (quotesListPage < 1) quotesListPage = 1;
    loadQuotes();
}

function viewQuote(id) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    window.location.href = `quote-builder.html?id=${qid}`;
}

async function deleteQuote(id) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    if (!confirm('Excluir este orçamento permanentemente? As linhas e o registo serão removidos. Esta ação não pode ser desfeita.')) {
        return;
    }
    try {
        const r = await fetch(`/api/quotes/${qid}`, { method: 'DELETE', credentials: 'include' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) {
            crmToastSafe(d.error || 'Não foi possível excluir o orçamento.', { type: 'error' });
            return;
        }
        crmToastSafe('Orçamento excluído.', { type: 'success' });
        if (typeof loadQuotes === 'function') loadQuotes();
    } catch (e) {
        crmToastSafe('Erro de rede ao excluir o orçamento.', { type: 'error' });
    }
}

function showNewQuoteModal() {
    window.location.href = 'quote-builder.html';
}

function loadEstimateAnalytics() {
    window.location.href = 'estimate-analytics.html';
}

function openImportInvoicePdfModal() {
    const modal = document.getElementById('importInvoicePdfModal');
    const form = document.getElementById('importInvoicePdfForm');
    const fileInput = document.getElementById('importInvoicePdfFile');
    const amountSec = document.getElementById('importInvoicePdfAmountSection');
    const amountEl = document.getElementById('importInvoicePdfAmount');
    const submitBtn = document.getElementById('importInvoicePdfSubmit');
    if (!modal || !form) return;
    form.reset();
    if (amountSec) amountSec.style.display = 'none';
    if (amountEl) amountEl.removeAttribute('required');
    if (submitBtn) submitBtn.disabled = true;
    if (fileInput) fileInput.value = '';
    modal.classList.add('active');
    modal.style.display = 'flex';
}

(function setupImportInvoicePdfModal() {
    const fileInput = document.getElementById('importInvoicePdfFile');
    const amountSec = document.getElementById('importInvoicePdfAmountSection');
    const amountEl = document.getElementById('importInvoicePdfAmount');
    const submitBtn = document.getElementById('importInvoicePdfSubmit');
    const form = document.getElementById('importInvoicePdfForm');
    const modal = document.getElementById('importInvoicePdfModal');
    if (!fileInput || !amountEl || !submitBtn || !form) return;

    function refreshSubmitState() {
        const hasFile = fileInput.files && fileInput.files.length > 0;
        const amt = parseFloat(String(amountEl.value || '').replace(',', '.'), 10);
        submitBtn.disabled = !(hasFile && Number.isFinite(amt) && amt >= 0);
    }

    fileInput.addEventListener('change', () => {
        const has = fileInput.files && fileInput.files.length > 0;
        if (amountSec) amountSec.style.display = has ? 'block' : 'none';
        if (has) {
            amountEl.setAttribute('required', 'required');
        } else {
            amountEl.removeAttribute('required');
            amountEl.value = '';
        }
        refreshSubmitState();
    });
    amountEl.addEventListener('input', refreshSubmitState);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!fileInput.files || !fileInput.files[0]) return;
        const fd = new FormData();
        fd.append('file', fileInput.files[0]);
        fd.append('total_amount', amountEl.value);
        submitBtn.disabled = true;
        const prevText = submitBtn.textContent;
        submitBtn.textContent = 'A guardar…';
        try {
            const res = await fetch('/api/quotes/import-invoice-pdf', {
                method: 'POST',
                credentials: 'include',
                body: fd,
            });
            const json = await res.json().catch(() => ({}));
            if (json.success) {
                if (typeof closeModal === 'function') closeModal('importInvoicePdfModal');
                else if (modal) modal.style.display = 'none';
                crmToastSafe('PDF importado com sucesso.', { type: 'success' });
                loadQuotes();
            } else {
                crmToastSafe(json.error || 'Erro ao importar PDF', { type: 'error' });
            }
        } catch (err) {
            crmToastSafe('Erro de rede ao importar PDF', { type: 'error' });
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = prevText;
            refreshSubmitState();
        }
    });
})();

// Projects
let projectsPage = 1;
async function loadProjects() {
    const tbody = document.getElementById('projectsTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/projects?page=${projectsPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">No projects found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(p => `
                    <tr>
                        <td>${p.id}</td>
                        <td>${p.name || '-'}</td>
                        <td>${p.customer_name || '-'}</td>
                        <td>${p.project_type || '-'}</td>
                        <td><span class="badge badge-${p.status || 'quoted'}">${p.status || 'quoted'}</span></td>
                        <td>$${parseFloat(p.estimated_cost || 0).toLocaleString()}</td>
                        <td>${p.estimated_start_date || '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewProject(${p.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoProjects').textContent = `Page ${projectsPage} of ${totalPages || 1}`;
            document.getElementById('prevPageProjects').disabled = projectsPage <= 1;
            document.getElementById('nextPageProjects').disabled = projectsPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageProjects(delta) {
    projectsPage += delta;
    if (projectsPage < 1) projectsPage = 1;
    loadProjects();
}

function viewProject(id) {
    if (typeof crmNotify === 'function') crmNotify('Ver projeto #' + id + ' — em breve.', 'info');
    else alert('View project ' + id + ' - Feature coming soon!');
}

function showNewProjectModal() {
    if (typeof crmNotify === 'function') crmNotify('Novo projeto — em breve.', 'info');
    else alert('New Project form - Coming soon!');
}

// Visits/Schedule
let visitsPage = 1;
async function loadVisits() {
    const tbody = document.getElementById('visitsTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/visits?page=${visitsPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">No visits scheduled</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(v => `
                    <tr>
                        <td>${v.id}</td>
                        <td>${v.scheduled_at ? new Date(v.scheduled_at).toLocaleString() : '-'}</td>
                        <td>${v.lead_name || v.customer_name || '-'}</td>
                        <td>${v.project_name || '-'}</td>
                        <td>${v.seller_id || '-'}</td>
                        <td><span class="badge badge-${v.status || 'scheduled'}">${v.status || 'scheduled'}</span></td>
                        <td><button class="btn btn-sm" onclick="viewVisit(${v.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoVisits').textContent = `Page ${visitsPage} of ${totalPages || 1}`;
            document.getElementById('prevPageVisits').disabled = visitsPage <= 1;
            document.getElementById('nextPageVisits').disabled = visitsPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageVisits(delta) {
    visitsPage += delta;
    if (visitsPage < 1) visitsPage = 1;
    loadVisits();
}

function viewVisit(id) {
    if (typeof crmNotify === 'function') crmNotify('Ver visita #' + id + ' — em breve.', 'info');
    else alert('View visit ' + id + ' - Feature coming soon!');
}

function showNewVisitModal() {
    if (typeof crmNotify === 'function') crmNotify('Nova visita — em breve.', 'info');
    else alert('New Visit form - Coming soon!');
}

// Contracts/Financeiro
let contractsPage = 1;
async function loadContracts() {
    const tbody = document.getElementById('contractsTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/contracts?page=${contractsPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">No contracts found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(c => `
                    <tr>
                        <td>${c.id}</td>
                        <td>${c.customer_name || '-'}</td>
                        <td>${c.project_name || '-'}</td>
                        <td>$${parseFloat(c.closed_amount || 0).toLocaleString()}</td>
                        <td>${c.payment_method || '-'}</td>
                        <td>${c.installments || 1}x</td>
                        <td>${c.start_date || '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewContract(${c.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoContracts').textContent = `Page ${contractsPage} of ${totalPages || 1}`;
            document.getElementById('prevPageContracts').disabled = contractsPage <= 1;
            document.getElementById('nextPageContracts').disabled = contractsPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageContracts(delta) {
    contractsPage += delta;
    if (contractsPage < 1) contractsPage = 1;
    loadContracts();
}

function viewContract(id) {
    if (typeof crmNotify === 'function') crmNotify('Ver contrato #' + id + ' — em breve.', 'info');
    else alert('View contract ' + id + ' - Feature coming soon!');
}

function showNewContractModal() {
    if (typeof crmNotify === 'function') crmNotify('Novo contrato — em breve.', 'info');
    else alert('New Contract form - Coming soon!');
}

// Activities
let activitiesPage = 1;
async function loadActivities() {
    const tbody = document.getElementById('activitiesTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/activities?page=${activitiesPage}&limit=50`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">No activities found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(a => `
                    <tr>
                        <td>${a.activity_date ? new Date(a.activity_date).toLocaleString() : '-'}</td>
                        <td>${a.activity_type || '-'}</td>
                        <td>${a.subject || '-'}</td>
                        <td>${a.related_to || '-'}</td>
                        <td>${a.user_name || '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewActivity(${a.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 50);
            document.getElementById('pageInfoActivities').textContent = `Page ${activitiesPage} of ${totalPages || 1}`;
            document.getElementById('prevPageActivities').disabled = activitiesPage <= 1;
            document.getElementById('nextPageActivities').disabled = activitiesPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageActivities(delta) {
    activitiesPage += delta;
    if (activitiesPage < 1) activitiesPage = 1;
    loadActivities();
}

function viewActivity(id) {
    if (typeof crmNotify === 'function') crmNotify('Ver atividade #' + id + ' — em breve.', 'info');
    else alert('View activity ' + id + ' - Feature coming soon!');
}

function showNewActivityModal() {
    if (typeof crmNotify === 'function') crmNotify('Nova atividade — em breve.', 'info');
    else alert('New Activity form - Coming soon!');
}

// Users & permissões por módulo
let usersPage = 1;
let permissionRegistryCache = null;

function escapeHtmlCrm(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

async function fetchPermissionRegistry() {
    if (permissionRegistryCache) return permissionRegistryCache;
    const res = await fetch('/api/permissions', { credentials: 'include' });
    const data = await res.json();
    permissionRegistryCache = data.success ? data : { by_group: {}, data: [] };
    return permissionRegistryCache;
}

async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">A carregar…</td></tr>';
    updateUsersPageActions();

    try {
        const response = await fetch(`/api/users?page=${usersPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();

        if (response.status === 403) {
            tbody.innerHTML =
                '<tr><td colspan="8" class="text-center">Sem permissão para ver utilizadores (' +
                escapeHtmlCrm(data.error || '') +
                ').</td></tr>';
            return;
        }

        if (data.success && data.data) {
            const canEdit = crmUserRole === 'admin' || crmUserPermissions.includes('users.edit');
            const canDel = crmUserRole === 'admin' || crmUserPermissions.includes('users.delete');

            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">Nenhum utilizador encontrado</td></tr>';
            } else {
                tbody.innerHTML = data.data
                    .map((u) => {
                        const active = u.is_active !== undefined ? u.is_active : u.active;
                        const mustPw = u.must_change_password ? ' <span class="badge badge-warning" title="Trocar senha">senha</span>' : '';
                        const actions = [];
                        if (canEdit)
                            actions.push(
                                `<button type="button" class="btn btn-sm" onclick="openCrmUserModal(${u.id})">Editar</button>`
                            );
                        if (canDel)
                            actions.push(
                                `<button type="button" class="btn btn-sm btn-danger" onclick="deactivateCrmUser(${u.id})">Desativar</button>`
                            );
                        return `<tr>
                        <td>${u.id}</td>
                        <td>${escapeHtmlCrm(u.name || '-')}${mustPw}</td>
                        <td>${escapeHtmlCrm(u.email || '-')}</td>
                        <td>${escapeHtmlCrm(u.phone || '-')}</td>
                        <td>${escapeHtmlCrm(u.role || '-')}</td>
                        <td><span class="badge badge-${active ? 'active' : 'inactive'}">${active ? 'Ativo' : 'Inativo'}</span></td>
                        <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('pt-PT') : '—'}</td>
                        <td>${actions.join(' ') || '—'}</td>
                    </tr>`;
                    })
                    .join('');
            }

            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoUsers').textContent = `Página ${usersPage} de ${totalPages || 1}`;
            document.getElementById('prevPageUsers').disabled = usersPage <= 1;
            document.getElementById('nextPageUsers').disabled = usersPage >= totalPages;
        } else {
            tbody.innerHTML =
                '<tr><td colspan="8" class="text-center">Erro: ' + escapeHtmlCrm(data.error || 'desconhecido') + '</td></tr>';
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Erro: ' + escapeHtmlCrm(error.message) + '</td></tr>';
    }
}

function changePageUsers(delta) {
    usersPage += delta;
    if (usersPage < 1) usersPage = 1;
    loadUsers();
}

function closeCrmUserModal() {
    const modal = document.getElementById('crmUserModal');
    if (modal) modal.classList.remove('active');
}

function showNewUserModal() {
    openCrmUserModal(null);
}

function renderPermCheckboxes(byGroup, selectedSet, enabled) {
    let html = '';
    const keys = Object.keys(byGroup || {}).sort();
    for (const g of keys) {
        const items = byGroup[g] || [];
        html +=
            '<div style="margin-bottom:0.75rem"><strong style="text-transform:capitalize">' +
            escapeHtmlCrm(g) +
            '</strong>';
        for (const p of items) {
            const id = p.id;
            const checked = selectedSet.has(id) ? ' checked' : '';
            const dis = enabled ? '' : ' disabled';
            html +=
                '<label style="display:flex;align-items:flex-start;gap:0.5rem;margin:0.25rem 0 0 1rem;cursor:' +
                (enabled ? 'pointer' : 'default') +
                '">' +
                '<input type="checkbox" class="crm-perm-cb" data-perm-id="' +
                id +
                '"' +
                checked +
                dis +
                '>' +
                '<span>' +
                escapeHtmlCrm(p.permission_name || p.permission_key) +
                ' <small style="color:#94a3b8">(' +
                escapeHtmlCrm(p.permission_key) +
                ')</small></span></label>';
        }
        html += '</div>';
    }
    return html || '<p>Nenhuma permissão na base de dados.</p>';
}

function collectSelectedPermissionIds() {
    return Array.from(document.querySelectorAll('.crm-perm-cb:checked'))
        .map((cb) => parseInt(cb.getAttribute('data-perm-id'), 10))
        .filter((n) => Number.isFinite(n));
}

async function openCrmUserModal(userId) {
    const modal = document.getElementById('crmUserModal');
    const title = document.getElementById('crmUserModalTitle');
    const errEl = document.getElementById('crmUserFormError');
    const permsSection = document.getElementById('crmUserPermsSection');
    const groupsEl = document.getElementById('crmUserPermsGroups');
    const form = document.getElementById('crmUserForm');
    if (!modal || !form) return;

    errEl.style.display = 'none';
    form.reset();
    document.getElementById('crmUserFormId').value = userId != null ? String(userId) : '';
    document.getElementById('crmUserActive').checked = true;
    document.getElementById('crmUserForcePwChange').checked = true;

    const canManage =
        crmUserRole === 'admin' || crmUserPermissions.includes('users.manage_permissions');
    const reg = await fetchPermissionRegistry();
    const byG = reg.by_group || {};

    const roleSelect = document.getElementById('crmUserRole');
    const onRoleChange = function () {
        if (roleSelect.value === 'admin') {
            permsSection.style.display = 'none';
        } else {
            permsSection.style.display = '';
        }
    };
    roleSelect.onchange = onRoleChange;

    if (userId != null) {
        title.textContent = 'Editar utilizador';
        document.getElementById('crmUserPasswordHint').textContent = '(deixe vazio para não alterar)';
        const [ur, pr] = await Promise.all([
            fetch(`/api/users/${userId}`, { credentials: 'include' }).then((r) => r.json()),
            fetch(`/api/users/${userId}/permissions`, { credentials: 'include' }).then((r) => r.json()),
        ]);
        if (!ur.success || !ur.data) {
            if (typeof crmNotify === 'function') crmNotify(ur.error || 'Erro ao carregar utilizador', 'error');
            else alert(ur.error || 'Erro ao carregar utilizador');
            return;
        }
        const d = ur.data;
        document.getElementById('crmUserName').value = d.name || '';
        document.getElementById('crmUserEmail').value = d.email || '';
        document.getElementById('crmUserPhone').value = d.phone || '';
        document.getElementById('crmUserRole').value = d.role || 'sales_rep';
        document.getElementById('crmUserPassword').value = '';
        const active = d.is_active !== undefined ? d.is_active : d.active;
        document.getElementById('crmUserActive').checked = !!active;
        document.getElementById('crmUserForcePwChange').checked = !!d.must_change_password;
        const selected = new Set(
            pr.success && pr.data && Array.isArray(pr.data.permission_ids) ? pr.data.permission_ids : []
        );
        if (String(d.role).toLowerCase() === 'admin') {
            permsSection.style.display = 'none';
        } else {
            permsSection.style.display = '';
            document.getElementById('crmUserPermsHelp').textContent = canManage
                ? 'Marque os módulos permitidos para este utilizador.'
                : 'Apenas utilizadores com permissão “Manage User Permissions” podem alterar isto.';
            groupsEl.innerHTML = renderPermCheckboxes(byG, selected, canManage);
        }
    } else {
        title.textContent = 'Novo utilizador';
        document.getElementById('crmUserPasswordHint').textContent = '(obrigatório, mín. 8 caracteres)';
        document.getElementById('crmUserRole').value = 'sales_rep';
        permsSection.style.display = '';
        document.getElementById('crmUserPermsHelp').textContent =
            'Opcional: deixe vazio para aplicar o pacote pré-definido por função. Ou marque módulos específicos.';
        groupsEl.innerHTML = renderPermCheckboxes(byG, new Set(), true);
        onRoleChange();
    }

    modal.classList.add('active');
}

async function deactivateCrmUser(id) {
    if (!confirm('Desativar este utilizador? Não poderá iniciar sessão.')) return;
    try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'include' });
        const j = await res.json();
        if (!res.ok) {
            if (typeof crmNotify === 'function') crmNotify(j.error || 'Falha ao desativar', 'error');
            else alert(j.error || 'Falha ao desativar');
            return;
        }
        loadUsers();
    } catch (e) {
        if (typeof crmNotify === 'function') crmNotify(e.message || 'Erro de rede', 'error');
        else alert(e.message || 'Erro de rede');
    }
}

async function onCrmUserFormSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('crmUserFormError');
    errEl.style.display = 'none';
    const id = document.getElementById('crmUserFormId').value.trim();
    const name = document.getElementById('crmUserName').value.trim();
    const email = document.getElementById('crmUserEmail').value.trim();
    const phone = document.getElementById('crmUserPhone').value.trim();
    const role = document.getElementById('crmUserRole').value;
    const pw = document.getElementById('crmUserPassword').value;
    const isActive = document.getElementById('crmUserActive').checked;
    const forcePw = document.getElementById('crmUserForcePwChange').checked;
    const submitBtn = document.getElementById('crmUserFormSubmit');

    if (!id && (!pw || pw.length < 8)) {
        errEl.textContent = 'Defina uma senha inicial com pelo menos 8 caracteres.';
        errEl.style.display = 'block';
        return;
    }
    if (pw && pw.length < 8) {
        errEl.textContent = 'A senha deve ter pelo menos 8 caracteres.';
        errEl.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    try {
        if (!id) {
            const body = {
                name,
                email,
                phone: phone || null,
                role,
                is_active: isActive,
                force_password_change: forcePw,
                password: pw,
            };
            if (role !== 'admin') {
                const pids = collectSelectedPermissionIds();
                if (pids.length > 0) body.permission_ids = pids;
            }
            const res = await fetch('/api/users', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!res.ok) {
                errEl.textContent = j.error || 'Erro ao criar.';
                errEl.style.display = 'block';
                submitBtn.disabled = false;
                return;
            }
        } else {
            const body = {
                name,
                email,
                phone: phone || null,
                role,
                is_active: isActive,
                force_password_change: forcePw,
            };
            if (pw) body.password = pw;
            const res = await fetch(`/api/users/${id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!res.ok) {
                errEl.textContent = j.error || 'Erro ao atualizar.';
                errEl.style.display = 'block';
                submitBtn.disabled = false;
                return;
            }
            if (
                role !== 'admin' &&
                (crmUserRole === 'admin' || crmUserPermissions.includes('users.manage_permissions'))
            ) {
                const pids = collectSelectedPermissionIds();
                const pr = await fetch(`/api/users/${id}/permissions`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ permission_ids: pids }),
                });
                const pj = await pr.json();
                if (!pr.ok) {
                    errEl.textContent = pj.error || 'Dados guardados, mas falhou ao atualizar permissões.';
                    errEl.style.display = 'block';
                    submitBtn.disabled = false;
                    loadUsers();
                    return;
                }
            }
        }
        closeCrmUserModal();
        permissionRegistryCache = null;
        loadUsers();
    } catch (ex) {
        errEl.textContent = ex.message || 'Erro de rede.';
        errEl.style.display = 'block';
    }
    submitBtn.disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
    const f = document.getElementById('crmUserForm');
    if (f) f.addEventListener('submit', onCrmUserFormSubmit);
    const ct = document.getElementById('clientType');
    if (ct) ct.addEventListener('change', syncClientFormBuilderFields);
    const clientPhone = document.getElementById('clientPhone');
    if (clientPhone) {
        clientPhone.addEventListener('input', function () {
            const next = formatUsPhoneMaskFromDigits(this.value);
            if (this.value !== next) this.value = next;
        });
    }
});
