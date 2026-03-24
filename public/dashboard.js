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

// Check authentication
fetch('/api/auth/session', { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
        if (!data.authenticated) {
            window.location.href = '/login.html';
            return;
        }
        loadDashboard();
        startNewLeadPolling();
        const pageParam = new URLSearchParams(window.location.search).get('page');
        if (pageParam && document.querySelector(`#dashboardSidebar [data-page="${pageParam}"]`)) {
            showPage(pageParam);
        }
    })
    .catch(err => {
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
document.getElementById('logoutBtn').addEventListener('click', async () => {
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

function updateMobileMenuVisibility() {
    if (mobileMenuToggle && dashboardSidebar) {
        if (isMobile()) {
            mobileMenuToggle.style.display = 'block';
        } else {
            mobileMenuToggle.style.display = 'none';
            dashboardSidebar.classList.remove('mobile-open');
            if (mobileOverlay) mobileOverlay.classList.remove('active');
        }
    }
}

if (mobileMenuToggle && dashboardSidebar && mobileOverlay) {
    mobileMenuToggle.addEventListener('click', () => {
        dashboardSidebar.classList.toggle('mobile-open');
        mobileOverlay.classList.toggle('active');
    });

    mobileOverlay.addEventListener('click', () => {
        dashboardSidebar.classList.remove('mobile-open');
        mobileOverlay.classList.remove('active');
    });

    // Close mobile menu when clicking sidebar nav only (evita apanhar .nav-item noutras zonas)
    dashboardSidebar.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (isMobile()) {
                dashboardSidebar.classList.remove('mobile-open');
                mobileOverlay.classList.remove('active');
            }
        });
    });
    
    // Update on resize
    window.addEventListener('resize', () => {
        updateMobileMenuVisibility();
        if (!isMobile()) {
            dashboardSidebar.classList.remove('mobile-open');
            mobileOverlay.classList.remove('active');
        }
    });
    updateMobileMenuVisibility();
}

// Navigation (só links da sidebar — nunca misturar com .nav-item noutros blocos)
const dashboardSidebarEl = document.getElementById('dashboardSidebar');
if (dashboardSidebarEl) {
    dashboardSidebarEl.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            if (page) showPage(page);
        });
    });
}

function showPage(pageName) {
    document.querySelectorAll('.page-content').forEach(p => p.style.display = 'none');

    const side = document.getElementById('dashboardSidebar');
    if (side) {
        side.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
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
        else if (pageName === 'quotes') { currentPage = 1; loadQuotes(); }
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
            <h3>Customers</h3>
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
            <h3>Revenue</h3>
            <div class="stat-value">$${parseFloat(stats.contracts.total_revenue || 0).toLocaleString()}</div>
            <div class="stat-details">
                <span>This Month: $${parseFloat(stats.contracts.this_month_revenue || 0).toLocaleString()}</span>
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
    
    // Leads Monthly Chart
    const leadsMonthlyCtx = document.getElementById('leadsMonthlyChart');
    if (leadsMonthlyCtx) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentMonth = new Date().getMonth();
        const monthlyData = months.map((_, i) => {
            if (i <= currentMonth) {
                return Math.floor(Math.random() * 20) + 5;
            }
            return 0;
        });
        
        chartInstances.leadsMonthly = new Chart(leadsMonthlyCtx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: 'Leads',
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
                        beginAtZero: true
                    }
                }
            }
        });
    }
    
    // Revenue Chart
    const revenueCtx = document.getElementById('revenueChart');
    if (revenueCtx) {
        chartInstances.revenue = new Chart(revenueCtx, {
            type: 'bar',
            data: {
                labels: ['Quotes', 'Accepted', 'Contracts', 'This Month'],
                datasets: [{
                    label: 'Revenue ($)',
                    data: [
                        parseFloat(stats.quotes.total_value || 0),
                        parseFloat(stats.quotes.accepted_value || 0),
                        parseFloat(stats.contracts.total_revenue || 0),
                        parseFloat(stats.contracts.this_month_revenue || 0)
                    ],
                    backgroundColor: [
                        chartColors.info,
                        chartColors.secondary,
                        chartColors.success,
                        chartColors.primary
                    ]
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
    
    // Sales Performance Chart
    const salesPerformanceCtx = document.getElementById('salesPerformanceChart');
    if (salesPerformanceCtx) {
        chartInstances.salesPerformance = new Chart(salesPerformanceCtx, {
            type: 'bar',
            data: {
                labels: ['Sales Rep 1', 'Sales Rep 2', 'Sales Rep 3'],
                datasets: [{
                    label: 'Leads',
                    data: [12, 8, 15],
                    backgroundColor: chartColors.secondary
                }, {
                    label: 'Converted',
                    data: [5, 3, 7],
                    backgroundColor: chartColors.success
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }
}

// Leads
let leadsPage = 1;
async function loadLeads() {
    const tbody = document.getElementById('leadsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">Loading...</td></tr>';
    }
    
    try {
        const response = await fetch(`/api/leads?page=${leadsPage}&limit=20`, { credentials: 'include' });
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
                        return `<tr>
                            <td>${lead.id}</td>
                            <td>${lead.name || '-'}${urgentBadge}</td>
                            <td>${lead.email || '-'}</td>
                            <td>${lead.phone || '-'}</td>
                            <td>${lead.zipcode || '-'}</td>
                            <td><span class="badge badge-${lead.status || 'new'}">${lead.status || 'new'}</span></td>
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
            
            const totalPages = Math.ceil(data.total / 20);
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
            alert(d.error || 'Não foi possível excluir o lead.');
            return;
        }
        if (currentPageName === 'leads' && typeof loadLeads === 'function') loadLeads();
        else if (currentPageName === 'crm') {
            if (typeof loadCRMKanban === 'function') loadCRMKanban();
            else if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
        }
    } catch (e) {
        alert('Erro de rede ao excluir.');
    }
}

// Make functions globally available
window.viewLead = viewLead;
window.deleteLead = deleteLead;

// Customers
let customersPage = 1;
async function loadCustomers() {
    const tbody = document.getElementById('customersTableBody');
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/customers?page=${customersPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center">No customers found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(c => `
                    <tr>
                        <td>${c.id}</td>
                        <td>${c.name || '-'}</td>
                        <td>${c.email || '-'}</td>
                        <td>${c.phone || '-'}</td>
                        <td>${c.city || '-'}</td>
                        <td>${c.customer_type || '-'}</td>
                        <td><span class="badge badge-${c.status || 'active'}">${c.status || 'active'}</span></td>
                        <td>${c.created_at ? new Date(c.created_at).toLocaleDateString() : '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewCustomer(${c.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoCustomers').textContent = `Page ${customersPage} of ${totalPages || 1}`;
            document.getElementById('prevPageCustomers').disabled = customersPage <= 1;
            document.getElementById('nextPageCustomers').disabled = customersPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageCustomers(delta) {
    customersPage += delta;
    if (customersPage < 1) customersPage = 1;
    loadCustomers();
}

function viewCustomer(id) {
    alert('View customer ' + id + ' - Feature coming soon!');
}

function showNewCustomerModal() {
    alert('New Customer form - Coming soon!');
}

// Quotes
let quotesPage = 1;
async function loadQuotes() {
    const tbody = document.getElementById('quotesTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/quotes?page=${quotesPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">No quotes found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(q => `
                    <tr>
                        <td>${q.quote_number || 'N/A'}</td>
                        <td>${q.customer_name || q.lead_name || '-'}</td>
                        <td>$${parseFloat(q.total_amount || 0).toLocaleString()}</td>
                        <td><span class="badge badge-${q.status || 'draft'}">${q.status || 'draft'}</span></td>
                        <td>${q.created_at ? new Date(q.created_at).toLocaleDateString() : '-'}</td>
                        <td>${q.expiration_date ? new Date(q.expiration_date).toLocaleDateString() : '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewQuote(${q.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoQuotes').textContent = `Page ${quotesPage} of ${totalPages || 1}`;
            document.getElementById('prevPageQuotes').disabled = quotesPage <= 1;
            document.getElementById('nextPageQuotes').disabled = quotesPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageQuotes(delta) {
    quotesPage += delta;
    if (quotesPage < 1) quotesPage = 1;
    loadQuotes();
}

function viewQuote(id) {
    alert('View quote ' + id + ' - Feature coming soon!');
}

function showNewQuoteModal() {
    alert('New Quote form - Coming soon!');
}

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
    alert('View project ' + id + ' - Feature coming soon!');
}

function showNewProjectModal() {
    alert('New Project form - Coming soon!');
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
    alert('View visit ' + id + ' - Feature coming soon!');
}

function showNewVisitModal() {
    alert('New Visit form - Coming soon!');
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
    alert('View contract ' + id + ' - Feature coming soon!');
}

function showNewContractModal() {
    alert('New Contract form - Coming soon!');
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
    alert('View activity ' + id + ' - Feature coming soon!');
}

function showNewActivityModal() {
    alert('New Activity form - Coming soon!');
}

// Users
let usersPage = 1;
async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/users?page=${usersPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">No users found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(u => `
                    <tr>
                        <td>${u.id}</td>
                        <td>${u.name || '-'}</td>
                        <td>${u.email || '-'}</td>
                        <td>${u.phone || '-'}</td>
                        <td>${u.role || '-'}</td>
                        <td><span class="badge badge-${(u.is_active !== undefined ? u.is_active : u.active) ? 'active' : 'inactive'}">${(u.is_active !== undefined ? u.is_active : u.active) ? 'Active' : 'Inactive'}</span></td>
                        <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewUser(${u.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoUsers').textContent = `Page ${usersPage} of ${totalPages || 1}`;
            document.getElementById('prevPageUsers').disabled = usersPage <= 1;
            document.getElementById('nextPageUsers').disabled = usersPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageUsers(delta) {
    usersPage += delta;
    if (usersPage < 1) usersPage = 1;
    loadUsers();
}

function viewUser(id) {
    alert('View user ' + id + ' - Feature coming soon!');
}

function showNewUserModal() {
    alert('New User form - Coming soon!');
}
