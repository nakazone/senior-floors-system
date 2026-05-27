/**
 * Leads Kanban — visualização única otimizada para iPad (9 colunas + Ver mais).
 */

let currentView = 'kanban';
let pipelineStages = [];
let allLeads = [];
/** lead_id → { quote_count, email_sent, viewed, pdf_viewed, … } */
let quoteEngagementByLeadId = {};
let allUsers = [];

/** Cards visíveis por coluna antes de "Ver mais" */
const KANBAN_CARDS_INITIAL = 5;
const KANBAN_CARDS_STEP = 8;

/** Por slug do estágio (fallback: id): quantos cards mostrar antes de "Ver mais" */
let kanbanColumnVisible = {};

const FALLBACK_PIPELINE_STAGES = [
  { id: 1, name: 'Novo lead', slug: 'new_lead', color: '#3498db', order_num: 1 },
  { id: 2, name: 'Contato realizado', slug: 'contacted', color: '#f39c12', order_num: 2 },
  { id: 3, name: 'Reunião agendada', slug: 'meeting_scheduled', color: '#e67e22', order_num: 3 },
  { id: 4, name: 'Orçamento enviado', slug: 'quote_sent', color: '#9b59b6', order_num: 4 },
  { id: 5, name: 'Follow-up 1', slug: 'follow_up_1', color: '#16a085', order_num: 5 },
  { id: 6, name: 'Follow-up 2', slug: 'follow_up_2', color: '#1abc9c', order_num: 6 },
  { id: 7, name: 'Tentativa de fechamento', slug: 'closing_attempt', color: '#e74c3c', order_num: 7 },
  { id: 8, name: 'Ganho', slug: 'won', color: '#27ae60', order_num: 8 },
  { id: 9, name: 'Perdido', slug: 'lost', color: '#c0392b', order_num: 9 },
];

function escapeKanbanHtml(text) {
  if (text == null || text === '') return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Exibe prioridade como icone (gelo / fogo), sem texto low|medium|high */
function kanbanPriorityMarkup(priorityRaw) {
  const p = String(priorityRaw || 'medium')
    .toLowerCase()
    .replace(/[^a-z]/g, '') || 'medium';
  if (p === 'high') {
    return `<span class="kanban-card-priority kanban-card-priority--emoji high" title="Alta" aria-label="Prioridade alta">\u{1F525}</span>`;
  }
  if (p === 'low') {
    return `<span class="kanban-card-priority kanban-card-priority--emoji low" title="Baixa" aria-label="Prioridade baixa">\u{1F9CA}</span>`;
  }
  return `<span class="kanban-card-priority kanban-card-priority--emoji medium" title="Media" aria-label="Prioridade media">\u2014</span>`;
}

function kanbanColumnTitle(stage) {
  if (typeof pipelineStageDisplayName === 'function') {
    return pipelineStageDisplayName(stage.slug, stage.name);
  }
  return stage.name || '';
}

async function loadLeadFormUsers() {
  try {
    const response = await fetch('/api/users?limit=100', { credentials: 'include' });
    const data = await response.json();

    if (data.success && data.data) {
      allUsers = data.data.filter(
        (u) => u.is_active !== 0 && (u.role === 'sales' || u.role === 'manager' || u.role === 'admin')
      );

      const selects = ['newLeadOwnerSelect', 'assignLeadOwnerSelect', 'followupAssignedSelect'];
      selects.forEach((selectId) => {
        const select = document.getElementById(selectId);
        if (select) {
          select.innerHTML = '<option value="">Não designar</option>';
          allUsers.forEach((user) => {
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

    pipelineStages = [...FALLBACK_PIPELINE_STAGES];
  } catch (error) {
    console.error('Error loading pipeline stages:', error);
    pipelineStages = [...FALLBACK_PIPELINE_STAGES];
  }
}

async function loadCRMKanban() {
  currentView = 'kanban';
  await loadLeadFormUsers();
  await loadPipelineStages();
  loadKanbanBoard();
}

function showKanbanView() {
  currentView = 'kanban';
  const kanbanView = document.getElementById('kanbanView');
  const listView = document.getElementById('listView');
  if (kanbanView) kanbanView.style.display = 'block';
  if (listView) listView.style.display = 'none';
  loadKanbanBoard();
}

function showListView() {
  showKanbanView();
}

function resolveStageForLead(lead) {
  if (!pipelineStages.length) return null;
  const byId = pipelineStages.find((s) => s.id === lead.pipeline_stage_id);
  if (byId) return byId;
  const bySlug = pipelineStages.find((s) => s.slug === lead.status);
  if (bySlug) return bySlug;
  return pipelineStages[0];
}

async function loadKanbanBoard() {
  try {
    const response = await fetch('/api/leads?limit=5000', { credentials: 'include' });
    const data = await response.json();

    if (data.success && data.data) {
      allLeads = data.data;
      quoteEngagementByLeadId = {};
      try {
        const engRes = await fetch('/api/leads/quote-engagement-summary', { credentials: 'include' });
        const engJson = await engRes.json().catch(() => ({}));
        if (engRes.ok && engJson.success && engJson.data) {
          quoteEngagementByLeadId = engJson.data;
          allLeads.forEach((l) => {
            l._quoteEngagement = quoteEngagementByLeadId[l.id] || null;
          });
        }
      } catch (engErr) {
        console.warn('Quote engagement summary:', engErr);
      }
      renderKanbanBoard();
      initKanbanDragDrop();
      bindKanbanLoadMore();
    }
  } catch (error) {
    console.error('Error loading kanban:', error);
  }
}

function renderKanbanBoard() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  board.innerHTML = '';

  pipelineStages.forEach((stage) => {
    const stageLeads = allLeads.filter((lead) => {
      const st = resolveStageForLead(lead);
      return st && st.id === stage.id;
    });

    const total = stageLeads.length;
    const visibleCap =
      typeof kanbanColumnVisible[stage.id] === 'number'
        ? kanbanColumnVisible[stage.id]
        : KANBAN_CARDS_INITIAL;
    const visibleLeads = stageLeads.slice(0, visibleCap);
    const remaining = total - visibleLeads.length;

    const column = document.createElement('div');
    column.className = 'kanban-column';
    column.dataset.stageId = stage.id;
    column.dataset.stageSlug = stage.slug;

    column.innerHTML = `
            <div class="kanban-column-header" style="background: ${stage.color || '#3498db'}">
                <div class="kanban-column-title">
                    <span>${escapeKanbanHtml(kanbanColumnTitle(stage))}</span>
                    <span class="kanban-column-count">${total}</span>
                </div>
            </div>
            <div class="kanban-column-cards" id="kanban-stage-${stage.id}">
                ${visibleLeads.map((lead) => renderKanbanCard(lead)).join('')}
            </div>
            ${
              remaining > 0
                ? `<div class="kanban-column-footer">
                <button type="button" class="btn btn-secondary btn-sm kanban-load-more-btn" data-stage-id="${stage.id}">
                    Ver mais (${remaining})
                </button>
            </div>`
                : ''
            }
        `;

    board.appendChild(column);
  });
}

function bindKanbanLoadMore() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;
  board.querySelectorAll('.kanban-load-more-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sid = parseInt(btn.dataset.stageId, 10);
      if (!sid) return;
      const cur = kanbanColumnVisible[sid] ?? KANBAN_CARDS_INITIAL;
      kanbanColumnVisible[sid] = cur + KANBAN_CARDS_STEP;
      renderKanbanBoard();
      initKanbanDragDrop();
      bindKanbanLoadMore();
    });
  });
}

function renderKanbanCard(lead) {
  const ownerName = lead.owner_name || 'Não designado';
  const quoteIcons =
    typeof renderLeadQuoteEngagementIconsHtml === 'function'
      ? renderLeadQuoteEngagementIconsHtml(
          lead._quoteEngagement || quoteEngagementByLeadId[lead.id] || null,
          escapeKanbanHtml,
          { compact: true }
        )
      : '';

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
            ${quoteIcons}
            <div class="kanban-card-footer">
                ${kanbanPriorityMarkup(lead.priority)}
                <span><span class="action-btn-icon small">U</span> ${ownerName}</span>
            </div>
        </div>
    `;
}

function initKanbanDragDrop() {
  if (typeof Sortable === 'undefined') {
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
  pipelineStages.forEach((stage) => {
    const cardsContainer = document.getElementById(`kanban-stage-${stage.id}`);
    if (cardsContainer) {
      new Sortable(cardsContainer, {
        group: 'kanban',
        animation: 150,
        onEnd: async (evt) => {
          const leadId = parseInt(evt.item.dataset.leadId);
          const col = evt.to.closest('.kanban-column');
          const newStageId = col ? parseInt(col.dataset.stageId) : null;
          const newStageSlug = col ? col.dataset.stageSlug : null;

          if (leadId && newStageId) {
            await updateLeadStage(leadId, newStageId, newStageSlug);
          }
        },
      });
    }
  });
}

async function updateLeadStage(leadId, stageId, stageSlug) {
  try {
    const response = await fetch(`/api/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        pipeline_stage_id: stageId,
        status: stageSlug,
      }),
    });

    const data = await response.json();
    if (data.success) {
      const lead = allLeads.find((l) => l.id === leadId);
      if (lead) {
        lead.pipeline_stage_id = stageId;
        lead.status = stageSlug;
      }
    } else {
      loadKanbanBoard();
      alert('Erro ao atualizar estágio: ' + (data.error || 'Desconhecido'));
    }
  } catch (error) {
    console.error('Error updating lead stage:', error);
    loadKanbanBoard();
    alert('Erro ao atualizar estágio');
  }
}

function showNewLeadModal() {
  loadLeadFormUsers();
  document.getElementById('newLeadModal').classList.add('active');
  document.getElementById('newLeadModal').style.display = 'flex';
}

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
    notes: formData.get('notes'),
  };

  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(leadData),
    });

    const data = await response.json();
    if (data.success) {
      alert('Lead criado com sucesso!');
      closeModal('newLeadModal');
      form.reset();
      loadKanbanBoard();
    } else {
      alert('Erro ao criar lead: ' + (data.error || 'Desconhecido'));
    }
  } catch (error) {
    console.error('Error creating lead:', error);
    alert('Erro ao criar lead');
  }
}

function showAssignLeadModal(leadId) {
  loadLeadFormUsers();
  document.getElementById('assignLeadId').value = leadId;
  document.getElementById('assignLeadModal').classList.add('active');
  document.getElementById('assignLeadModal').style.display = 'flex';
}

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
      body: JSON.stringify({ owner_id: ownerId }),
    });

    const data = await response.json();
    if (data.success) {
      alert('Lead designado com sucesso!');
      closeModal('assignLeadModal');
      loadKanbanBoard();
    } else {
      alert('Erro ao designar lead: ' + (data.error || 'Desconhecido'));
    }
  } catch (error) {
    console.error('Error assigning lead:', error);
    alert('Erro ao designar lead');
  }
}

function showFollowupModal(leadId) {
  loadLeadFormUsers();
  document.getElementById('followupLeadId').value = leadId;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const datetimeLocal = tomorrow.toISOString().slice(0, 16);
  document.querySelector('#followupForm input[name="due_date"]').value = datetimeLocal;

  document.getElementById('followupModal').classList.add('active');
  document.getElementById('followupModal').style.display = 'flex';
}

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
    assigned_to: formData.get('assigned_to') || null,
  };

  try {
    const response = await fetch(`/api/leads/${leadId}/followups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(followupData),
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

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
    e.target.style.display = 'none';
  }
});

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

  const origLoadLeads = window.loadLeads;
  window.loadLeads = async function () {
    if (typeof loadCRMKanban === 'function') await loadCRMKanban();
    else if (typeof origLoadLeads === 'function') await origLoadLeads();
  };
}
