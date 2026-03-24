/**
 * Leads Kanban Board and Management Functions
 */

let currentView = 'list'; // 'list' or 'kanban'
let pipelineStages = [];
let allLeads = [];
let allUsers = [];

// Load users for selects
async function loadUsers() {
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
    await loadUsers();
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
        
        if (data.success && data.data) {
            allLeads = data.data;
            renderKanbanBoard();
            initKanbanDragDrop();
        }
    } catch (error) {
        console.error('Error loading kanban:', error);
    }
}

// Render Kanban Board
function renderKanbanBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;
    
    board.innerHTML = '';
    
    pipelineStages.forEach(stage => {
        const stageLeads = allLeads.filter(lead => 
            lead.pipeline_stage_id === stage.id || 
            (lead.status === stage.slug && !lead.pipeline_stage_id)
        );
        
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
                ${stageLeads.map(lead => renderKanbanCard(lead)).join('')}
            </div>
        `;
        
        board.appendChild(column);
    });
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
    pipelineStages.forEach(stage => {
        const cardsContainer = document.getElementById(`kanban-stage-${stage.id}`);
        if (cardsContainer) {
            new Sortable(cardsContainer, {
                group: 'kanban',
                animation: 150,
                onEnd: async (evt) => {
                    const leadId = parseInt(evt.item.dataset.leadId);
                    const newStageId = parseInt(evt.to.closest('.kanban-column').dataset.stageId);
                    const newStageSlug = evt.to.closest('.kanban-column').dataset.stageSlug;
                    
                    if (leadId && newStageId) {
                        await updateLeadStage(leadId, newStageId, newStageSlug);
                    }
                }
            });
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
            // Update local data
            const lead = allLeads.find(l => l.id === leadId);
            if (lead) {
                lead.pipeline_stage_id = stageId;
                lead.status = stageSlug;
            }
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
    loadUsers();
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
    loadUsers();
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
    loadUsers();
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
            await loadUsers();
            await loadPipelineStages();
        };
    }
}
