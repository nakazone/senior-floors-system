/**
 * Leads Kanban Board and Management Functions
 */

let currentView = 'list'; // 'list' or 'kanban'
let pipelineStages = [];
let allLeads = [];
let allUsers = [];
/** Todas as visitas scheduled da API (Kanban filtra por estágio do lead) */
let scheduledVisitsRawForKanban = [];
/** Instâncias Sortable ativas (destruir antes de re-render para não duplicar onEnd nem “prender” cartões) */
let kanbanSortableInstances = [];

function kanbanNumericId(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

function findLeadByIdKanban(leadId) {
    const n = kanbanNumericId(leadId);
    if (!Number.isFinite(n)) return undefined;
    return allLeads.find((l) => kanbanNumericId(l.id) === n);
}

function destroyKanbanSortables() {
    while (kanbanSortableInstances.length) {
        const s = kanbanSortableInstances.pop();
        try {
            if (s && typeof s.destroy === 'function') s.destroy();
        } catch (e) {
            /* ignore */
        }
    }
}

function escapeKanbanHtml(s) {
    if (s == null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

function formatVisitKanbanDateTime(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return '—';
    }
}

// Load users for modais de lead (não confundir com loadUsers() da página Users em dashboard.js)
async function loadLeadFormUsers() {
    try {
        const response = await fetch('/api/users?limit=100', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            allUsers = data.data.filter(u => u.is_active !== 0 && u.role === 'sales' || u.role === 'manager' || u.role === 'admin');
            
            // Populate selects
            const selects = ['newLeadOwnerSelect', 'assignLeadOwnerSelect', 'followupAssignedSelect'];
            selects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    select.innerHTML = '<option value="">Não designar</option>';
                    allUsers.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = `${user.name} (${user.email})`;
                        select.appendChild(option);
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Load pipeline stages
async function loadPipelineStages() {
    try {
        const response = await fetch('/api/pipeline-stages', { credentials: 'include' }).catch(() => null);
        
        if (response && response.ok) {
            const data = await response.json();
            if (data.success) {
                pipelineStages = data.data.sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
                return;
            }
        }
        
        // Fallback: default stages
        pipelineStages = [
            { id: 1, name: 'Lead Recebido', slug: 'lead_received', color: '#3498db', order_num: 1 },
            { id: 2, name: 'Contato Realizado', slug: 'contact_made', color: '#f39c12', order_num: 2 },
            { id: 3, name: 'Qualificado', slug: 'qualified', color: '#9b59b6', order_num: 3 },
            { id: 4, name: 'Visita Agendada', slug: 'visit_scheduled', color: '#e67e22', order_num: 4 },
            { id: 5, name: 'Medição Realizada', slug: 'measurement_done', color: '#16a085', order_num: 5 },
            { id: 6, name: 'Proposta Criada', slug: 'proposal_created', color: '#34495e', order_num: 6 },
            { id: 7, name: 'Proposta Enviada', slug: 'proposal_sent', color: '#95a5a6', order_num: 7 },
            { id: 8, name: 'Em Negociação', slug: 'negotiation', color: '#e74c3c', order_num: 8 },
            { id: 9, name: 'Fechado - Ganhou', slug: 'closed_won', color: '#27ae60', order_num: 9 },
            { id: 10, name: 'Fechado - Perdido', slug: 'closed_lost', color: '#c0392b', order_num: 10 },
            { id: 11, name: 'Produção / Obra', slug: 'production', color: '#8e44ad', order_num: 11 }
        ];
    } catch (error) {
        console.error('Error loading pipeline stages:', error);
        // Use fallback
        pipelineStages = [
            { id: 1, name: 'Lead Recebido', slug: 'lead_received', color: '#3498db', order_num: 1 },
            { id: 2, name: 'Contato Realizado', slug: 'contact_made', color: '#f39c12', order_num: 2 },
            { id: 3, name: 'Qualificado', slug: 'qualified', color: '#9b59b6', order_num: 3 },
            { id: 4, name: 'Visita Agendada', slug: 'visit_scheduled', color: '#e67e22', order_num: 4 },
            { id: 5, name: 'Medição Realizada', slug: 'measurement_done', color: '#16a085', order_num: 5 },
            { id: 6, name: 'Proposta Criada', slug: 'proposal_created', color: '#34495e', order_num: 6 },
            { id: 7, name: 'Proposta Enviada', slug: 'proposal_sent', color: '#95a5a6', order_num: 7 },
            { id: 8, name: 'Em Negociação', slug: 'negotiation', color: '#e74c3c', order_num: 8 },
            { id: 9, name: 'Fechado - Ganhou', slug: 'closed_won', color: '#27ae60', order_num: 9 },
            { id: 10, name: 'Fechado - Perdido', slug: 'closed_lost', color: '#c0392b', order_num: 10 },
            { id: 11, name: 'Produção / Obra', slug: 'production', color: '#8e44ad', order_num: 11 }
        ];
    }
}

// Load CRM Kanban (called from dashboard)
async function loadCRMKanban() {
    currentView = 'kanban';
    // Load required data first
    await loadLeadFormUsers();
    await loadPipelineStages();
    // Then load kanban board
    loadKanbanBoard();
}

// Show Kanban View (deprecated - kept for compatibility)
function showKanbanView() {
    currentView = 'kanban';
    const kanbanView = document.getElementById('kanbanView');
    const listView = document.getElementById('listView');
    if (kanbanView) kanbanView.style.display = 'block';
    if (listView) listView.style.display = 'none';
    loadKanbanBoard();
}

// Show List View (deprecated - kept for compatibility)
function showListView() {
    currentView = 'list';
    const kanbanView = document.getElementById('kanbanView');
    const listView = document.getElementById('listView');
    if (kanbanView) kanbanView.style.display = 'none';
    if (listView) listView.style.display = 'block';
}

// Load Kanban Board
async function loadKanbanBoard() {
    try {
        const response = await fetch('/api/leads?limit=1000', { credentials: 'include' });
        const data = await response.json();

        scheduledVisitsRawForKanban = [];
        try {
            const vr = await fetch('/api/visits?limit=500&status=scheduled', { credentials: 'include' });
            const vj = await vr.json();
            if (vj.success && Array.isArray(vj.data)) {
                scheduledVisitsRawForKanban = vj.data.slice();
            }
        } catch (ve) {
            console.warn('Kanban: visitas não carregadas', ve);
        }

        if (data.success && data.data) {
            allLeads = data.data;
            renderKanbanBoard();
            initKanbanDragDrop();
        }
    } catch (error) {
        console.error('Error loading kanban:', error);
    }
}

function getVisitScheduledPipelineStage() {
    return pipelineStages.find((s) => s.slug === 'visit_scheduled') || null;
}

function leadIsInVisitScheduledStage(lead, visitStage) {
    if (!visitStage || !lead) return false;
    const sid = kanbanNumericId(visitStage.id);
    const lid = kanbanNumericId(lead.pipeline_stage_id);
    const sameStageById = Number.isFinite(sid) && Number.isFinite(lid) && lid === sid;
    const sameBySlugOnly =
        lead.status === visitStage.slug &&
        (lead.pipeline_stage_id == null || lead.pipeline_stage_id === '');
    return sameStageById || sameBySlugOnly;
}

/** Visitas a mostrar na coluna dedicada: scheduled e lead ainda em "Visita Agendada" */
function getScheduledVisitsForKanbanColumn() {
    const visitStage = getVisitScheduledPipelineStage();
    const filtered = scheduledVisitsRawForKanban.filter((v) => {
        const lead = findLeadByIdKanban(v.lead_id);
        if (!lead) return false;
        if (!visitStage) return true;
        return leadIsInVisitScheduledStage(lead, visitStage);
    });
    return filtered.sort((a, b) => {
        const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return ta - tb;
    });
}

/** Estágio(s) de qualificação: coluna de visitas agendadas vem logo a seguir */
function isKanbanQualificationStage(stage) {
    if (!stage || !stage.slug) return false;
    const s = String(stage.slug).toLowerCase();
    return s === 'qualified' || s === 'qualification' || s === 'qualificado';
}

function buildVisitsKanbanColumnElement(visitsForColumn) {
    const visitsColumn = document.createElement('div');
    visitsColumn.className = 'kanban-column kanban-column--visits';
    visitsColumn.dataset.visitOnly = 'true';
    visitsColumn.dataset.stageId = '0';
    visitsColumn.dataset.stageSlug = 'visit_booked_column';
    const visitCardsHtml =
        visitsForColumn.length === 0
            ? '<div class="kanban-column-empty">Nenhuma visita agendada</div>'
            : visitsForColumn.map((v) => renderVisitKanbanCard(v)).join('');
    visitsColumn.innerHTML = `
            <div class="kanban-column-header kanban-column-header--visits">
                <div class="kanban-column-title">
                    <span>📅 Visitas agendadas</span>
                    <span class="kanban-column-count">${visitsForColumn.length}</span>
                </div>
            </div>
            <div class="kanban-column-cards" id="kanban-visits-cards">
                ${visitCardsHtml}
            </div>
        `;
    return visitsColumn;
}

// Render Kanban Board
function renderKanbanBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    destroyKanbanSortables();

    const visitStage = getVisitScheduledPipelineStage();
    const visitsForColumn = getScheduledVisitsForKanbanColumn();
    const visitColumnLeadIds = new Set(
        visitsForColumn.map((v) => kanbanNumericId(v.lead_id)).filter((n) => Number.isFinite(n))
    );

    board.innerHTML = '';

    const visitsColumnEl = buildVisitsKanbanColumnElement(visitsForColumn);
    let visitsColumnInserted = false;

    const appendStageColumn = (stage) => {
        const stageLeads = allLeads.filter((lead) => {
            const matchesStage =
                kanbanNumericId(lead.pipeline_stage_id) === kanbanNumericId(stage.id) ||
                (lead.status === stage.slug && (lead.pipeline_stage_id == null || lead.pipeline_stage_id === ''));
            if (!matchesStage) return false;
            if (
                visitStage &&
                stage.id === visitStage.id &&
                visitColumnLeadIds.has(kanbanNumericId(lead.id))
            ) {
                return false;
            }
            return true;
        });

        const column = document.createElement('div');
        column.className = 'kanban-column';
        column.dataset.stageId = stage.id;
        column.dataset.stageSlug = stage.slug;

        column.innerHTML = `
            <div class="kanban-column-header" style="background: ${stage.color || '#3498db'}">
                <div class="kanban-column-title">
                    <span>${stage.name}</span>
                    <span class="kanban-column-count">${stageLeads.length}</span>
                </div>
            </div>
            <div class="kanban-column-cards" id="kanban-stage-${stage.id}">
                ${stageLeads.map((lead) => renderKanbanCard(lead)).join('')}
            </div>
        `;

        board.appendChild(column);
    };

    pipelineStages.forEach((stage) => {
        if (!visitsColumnInserted && stage.slug === 'visit_scheduled') {
            board.appendChild(visitsColumnEl);
            visitsColumnInserted = true;
        }
        appendStageColumn(stage);
        if (!visitsColumnInserted && isKanbanQualificationStage(stage)) {
            board.appendChild(visitsColumnEl);
            visitsColumnInserted = true;
        }
    });

    if (!visitsColumnInserted) {
        board.appendChild(visitsColumnEl);
    }
}

function visitKanbanAddress(v) {
    const a = v.address && String(v.address).trim();
    if (a) return a.length > 90 ? a.slice(0, 87) + '…' : a;
    return buildAddressFromVisitParts(v);
}

function buildAddressFromVisitParts(v) {
    const parts = [v.address_line1, v.city, v.zipcode].filter(Boolean).map(String).map((s) => s.trim());
    const s = parts.join(', ');
    return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

function renderVisitKanbanCard(visit) {
    const lead = findLeadByIdKanban(visit.lead_id);
    const name = escapeKanbanHtml(visit.lead_name || lead?.name || 'Lead');
    const when = formatVisitKanbanDateTime(visit.scheduled_at);
    const addr = escapeKanbanHtml(visitKanbanAddress(visit) || '—');
    const assignee = escapeKanbanHtml(visit.assigned_to_name || '');
    const priorityClass = lead?.priority || 'medium';
    const leadId = kanbanNumericId(visit.lead_id);
    const leadIdAttr = Number.isFinite(leadId) ? leadId : '';
    return `
        <div class="kanban-card kanban-card--visit" data-lead-id="${leadIdAttr}" data-visit-id="${visit.id}" draggable="true">
            <div class="kanban-card-header">
                <div class="kanban-card-title">${name}</div>
                <div class="kanban-card-actions">
                    <button type="button" onclick="viewLead(${leadIdAttr})" title="Ver lead"><span class="action-btn-icon">V</span></button>
                    <button type="button" onclick="showAssignLeadModal(${leadIdAttr})" title="Designar"><span class="action-btn-icon">U</span></button>
                    <button type="button" onclick="showFollowupModal(${leadIdAttr})" title="Follow-up"><span class="action-btn-icon">D</span></button>
                </div>
            </div>
            <div class="kanban-card-body kanban-card-body--visit">
                <div class="kanban-visit-datetime"><strong>Quando:</strong> ${escapeKanbanHtml(when)}</div>
                <div><strong>Local:</strong> ${addr}</div>
                ${assignee ? `<div><strong>Responsável:</strong> ${assignee}</div>` : ''}
            </div>
            <div class="kanban-card-footer">
                <span class="kanban-card-priority ${priorityClass}">${priorityClass}</span>
                <span class="kanban-visit-hint">Arraste para mudar o estágio do lead</span>
            </div>
        </div>
    `;
}

// Render Kanban Card
function renderKanbanCard(lead) {
    const priorityClass = lead.priority || 'medium';
    const ownerName = lead.owner_name || 'Não designado';
    
    return `
        <div class="kanban-card" data-lead-id="${lead.id}" draggable="true">
            <div class="kanban-card-header">
                <div class="kanban-card-title">${lead.name || 'Sem nome'}</div>
                <div class="kanban-card-actions">
                    <button onclick="viewLead(${lead.id})" title="Ver"><span class="action-btn-icon">V</span></button>
                    <button onclick="showAssignLeadModal(${lead.id})" title="Designar"><span class="action-btn-icon">U</span></button>
                    <button onclick="showFollowupModal(${lead.id})" title="Follow-up"><span class="action-btn-icon">D</span></button>
                    <button type="button" class="btn-lead-delete-kanban" onclick="deleteLead(${lead.id})" title="Excluir">✕</button>
                </div>
            </div>
            <div class="kanban-card-body">
                <div><strong>Email:</strong> ${lead.email || '-'}</div>
                <div><strong>Phone:</strong> ${lead.phone || '-'}</div>
                ${lead.estimated_value ? `<div><strong>Value:</strong> $${parseFloat(lead.estimated_value).toLocaleString()}</div>` : ''}
            </div>
            <div class="kanban-card-footer">
                <span class="kanban-card-priority ${priorityClass}">${priorityClass}</span>
                <span><span class="action-btn-icon small">U</span> ${ownerName}</span>
            </div>
        </div>
    `;
}

// Initialize Drag and Drop
function initKanbanDragDrop() {
    if (typeof Sortable === 'undefined') {
        // Load SortableJS
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js';
        script.onload = () => {
            setupSortable();
        };
        document.head.appendChild(script);
    } else {
        setupSortable();
    }
}

function setupSortable() {
    const visitsCards = document.getElementById('kanban-visits-cards');
    if (visitsCards && typeof Sortable !== 'undefined') {
        kanbanSortableInstances.push(
            new Sortable(visitsCards, {
                group: { name: 'kanban', pull: true, put: false },
                animation: 150,
                onEnd: async (evt) => {
                    const leadId = kanbanNumericId(evt.item.dataset.leadId);
                    const col = evt.to.closest('.kanban-column');
                    if (!col || col.dataset.visitOnly === 'true') return;
                    const newStageId = parseInt(col.dataset.stageId, 10);
                    const newStageSlug = col.dataset.stageSlug;
                    if (Number.isFinite(leadId) && newStageId) {
                        await updateLeadStage(leadId, newStageId, newStageSlug);
                    }
                },
            })
        );
    }

    pipelineStages.forEach((stage) => {
        const cardsContainer = document.getElementById(`kanban-stage-${stage.id}`);
        if (cardsContainer) {
            kanbanSortableInstances.push(
                new Sortable(cardsContainer, {
                    group: 'kanban',
                    animation: 150,
                    onEnd: async (evt) => {
                        const leadId = kanbanNumericId(evt.item.dataset.leadId);
                        const col = evt.to.closest('.kanban-column');
                        if (!col || col.dataset.visitOnly === 'true') return;
                        const newStageId = parseInt(col.dataset.stageId, 10);
                        const newStageSlug = col.dataset.stageSlug;

                        if (Number.isFinite(leadId) && newStageId) {
                            await updateLeadStage(leadId, newStageId, newStageSlug);
                        }
                    },
                })
            );
        }
    });
}

// Update Lead Stage (when dragged)
async function updateLeadStage(leadId, stageId, stageSlug) {
    try {
        const response = await fetch(`/api/leads/${leadId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                pipeline_stage_id: stageId,
                status: stageSlug
            })
        });
        
        const data = await response.json();
        if (data.success) {
            await loadKanbanBoard();
            return;
        } else {
            // Revert on error
            loadKanbanBoard();
            alert('Erro ao atualizar estágio: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error updating lead stage:', error);
        loadKanbanBoard();
        alert('Erro ao atualizar estágio');
    }
}

// Show New Lead Modal
function showNewLeadModal() {
    loadLeadFormUsers();
    document.getElementById('newLeadModal').classList.add('active');
    document.getElementById('newLeadModal').style.display = 'flex';
}

// Create Lead Manually
async function createLeadManual(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const leadData = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        zipcode: formData.get('zipcode'),
        message: formData.get('message'),
        source: formData.get('source') || 'Manual',
        priority: formData.get('priority') || 'medium',
        owner_id: formData.get('owner_id') || null,
        estimated_value: parseFloat(formData.get('estimated_value')) || null,
        notes: formData.get('notes')
    };
    
    try {
        const response = await fetch('/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(leadData)
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Lead criado com sucesso!');
            closeModal('newLeadModal');
            form.reset();
            if (currentView === 'kanban') {
                loadKanbanBoard();
            } else {
                loadLeads();
            }
        } else {
            alert('Erro ao criar lead: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error creating lead:', error);
        alert('Erro ao criar lead');
    }
}

// Show Assign Lead Modal
function showAssignLeadModal(leadId) {
    loadLeadFormUsers();
    document.getElementById('assignLeadId').value = leadId;
    document.getElementById('assignLeadModal').classList.add('active');
    document.getElementById('assignLeadModal').style.display = 'flex';
}

// Assign Lead
async function assignLead(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const leadId = parseInt(formData.get('lead_id'));
    const ownerId = formData.get('owner_id') || null;
    
    try {
        const response = await fetch(`/api/leads/${leadId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ owner_id: ownerId })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Lead designado com sucesso!');
            closeModal('assignLeadModal');
            if (currentView === 'kanban') {
                loadKanbanBoard();
            } else {
                loadLeads();
            }
        } else {
            alert('Erro ao designar lead: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error assigning lead:', error);
        alert('Erro ao designar lead');
    }
}

// Show Follow-up Modal
function showFollowupModal(leadId) {
    loadLeadFormUsers();
    document.getElementById('followupLeadId').value = leadId;
    
    // Set default due date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const datetimeLocal = tomorrow.toISOString().slice(0, 16);
    document.querySelector('#followupForm input[name="due_date"]').value = datetimeLocal;
    
    document.getElementById('followupModal').classList.add('active');
    document.getElementById('followupModal').style.display = 'flex';
}

// Create Follow-up
async function createFollowup(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const leadId = parseInt(formData.get('lead_id'));
    
    const followupData = {
        title: formData.get('title'),
        description: formData.get('description'),
        due_date: formData.get('due_date'),
        priority: formData.get('priority') || 'medium',
        assigned_to: formData.get('assigned_to') || null
    };
    
    try {
        const response = await fetch(`/api/leads/${leadId}/followups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(followupData)
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Follow-up criado com sucesso!');
            closeModal('followupModal');
            form.reset();
        } else {
            alert('Erro ao criar follow-up: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error creating followup:', error);
        alert('Erro ao criar follow-up');
    }
}

// Close Modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}

// Close modals when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
        e.target.style.display = 'none';
    }
});

// Initialize on page load
if (typeof window !== 'undefined') {
    window.showKanbanView = showKanbanView;
    window.showListView = showListView;
    window.loadCRMKanban = loadCRMKanban;
    window.showNewLeadModal = showNewLeadModal;
    window.showAssignLeadModal = showAssignLeadModal;
    window.showFollowupModal = showFollowupModal;
    window.createLeadManual = createLeadManual;
    window.assignLead = assignLead;
    window.createFollowup = createFollowup;
    window.closeModal = closeModal;
    window.loadKanbanBoard = loadKanbanBoard;
    
    // loadCRMKanban is already defined above
    
    // Load data when leads page is shown
    const originalLoadLeads = window.loadLeads;
    if (originalLoadLeads) {
        window.loadLeads = async function() {
            await originalLoadLeads();
            await loadLeadFormUsers();
            await loadPipelineStages();
        };
    }
}
