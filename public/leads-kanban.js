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

/** Kanban iPad: cards por coluna + Ver mais */
const KANBAN_CARDS_INITIAL = 5;
const KANBAN_CARDS_STEP = 8;
/** Chave = slug do estágio (ex.: meeting_scheduled); usado em "Ver mais" */
let kanbanColumnVisible = {};

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


function kanbanColumnTitle(stage) {
    if (typeof pipelineStageDisplayName === 'function') {
        return pipelineStageDisplayName(stage.slug, stage.name);
    }
    return (stage && stage.name) || '';
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
                const merged =
                    typeof mergePipelineStagesForKanban === 'function'
                        ? mergePipelineStagesForKanban(data.data || [])
                        : data.data || [];
                pipelineStages = merged.sort((a, b) => {
                    const slugs =
                        typeof PIPELINE_V9_SLUGS !== 'undefined' && Array.isArray(PIPELINE_V9_SLUGS)
                            ? PIPELINE_V9_SLUGS
                            : null;
                    if (slugs) {
                        const ia = slugs.indexOf(a.slug);
                        const ib = slugs.indexOf(b.slug);
                        if (ia !== -1 && ib !== -1) return ia - ib;
                    }
                    return (a.order_num || 0) - (b.order_num || 0);
                });
                return;
            }
        }
        
        // Fallback: Kanban v3 (9 colunas)
        pipelineStages = [
            { id: 1, name: 'New Lead', slug: 'new_lead', color: '#3498db', order_num: 1 },
            { id: 2, name: 'Contacted', slug: 'contacted', color: '#f39c12', order_num: 2 },
            { id: 3, name: 'Meeting Scheduled', slug: 'meeting_scheduled', color: '#e67e22', order_num: 3 },
            { id: 4, name: 'Quote Sent', slug: 'quote_sent', color: '#9b59b6', order_num: 4 },
            { id: 5, name: 'Follow Up 1', slug: 'follow_up_1', color: '#16a085', order_num: 5 },
            { id: 6, name: 'Follow Up 2', slug: 'follow_up_2', color: '#1abc9c', order_num: 6 },
            { id: 7, name: 'Closing Attempt', slug: 'closing_attempt', color: '#e74c3c', order_num: 7 },
            { id: 8, name: 'Won', slug: 'won', color: '#27ae60', order_num: 8 },
            { id: 9, name: 'Lost', slug: 'lost', color: '#c0392b', order_num: 9 },
        ];
    } catch (error) {
        console.error('Error loading pipeline stages:', error);
        // Use fallback
        pipelineStages = [
            { id: 1, name: 'New Lead', slug: 'new_lead', color: '#3498db', order_num: 1 },
            { id: 2, name: 'Contacted', slug: 'contacted', color: '#f39c12', order_num: 2 },
            { id: 3, name: 'Meeting Scheduled', slug: 'meeting_scheduled', color: '#e67e22', order_num: 3 },
            { id: 4, name: 'Quote Sent', slug: 'quote_sent', color: '#9b59b6', order_num: 4 },
            { id: 5, name: 'Follow Up 1', slug: 'follow_up_1', color: '#16a085', order_num: 5 },
            { id: 6, name: 'Follow Up 2', slug: 'follow_up_2', color: '#1abc9c', order_num: 6 },
            { id: 7, name: 'Closing Attempt', slug: 'closing_attempt', color: '#e74c3c', order_num: 7 },
            { id: 8, name: 'Won', slug: 'won', color: '#27ae60', order_num: 8 },
            { id: 9, name: 'Lost', slug: 'lost', color: '#c0392b', order_num: 9 },
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
    showKanbanView();
}

/** Normalize legacy `leads.status` / slug typos to canonical pipeline slug (matches migrate-pipeline-kanban-v3). */
function normalizeLeadPipelineSlug(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const legacy = {
        lead_received: 'new_lead',
        new: 'new_lead',
        contact_made: 'contacted',
        qualified: 'contacted',
        visit_scheduled: 'meeting_scheduled',
        measurement_done: 'follow_up_1',
        proposal_created: 'quote_sent',
        proposal_sent: 'quote_sent',
        negotiation: 'closing_attempt',
        closed_won: 'won',
        closed_lost: 'lost',
        production: 'won',
    };
    if (legacy[s]) return legacy[s];
    const lower = s.toLowerCase().replace(/\s+/g, '_');
    if (legacy[lower]) return legacy[lower];
    return s;
}

function resolveStageForLead(lead) {
    if (!pipelineStages.length) return null;
    const byId = pipelineStages.find((s) => kanbanNumericId(s.id) === kanbanNumericId(lead.pipeline_stage_id));
    if (byId) return byId;
    const fromApi = (lead.pipeline_stage_slug || '').trim();
    const raw = fromApi || lead.status || '';
    const leadCanon =
        typeof normalizePipelineSlug === 'function'
            ? normalizePipelineSlug(raw)
            : normalizeLeadPipelineSlug(raw);
    const bySlug = pipelineStages.find((s) => {
        const stageCanon =
            typeof normalizePipelineSlug === 'function'
                ? normalizePipelineSlug(s.slug || '')
                : normalizeLeadPipelineSlug(s.slug || '');
        return stageCanon === leadCanon;
    });
    if (bySlug) return bySlug;
    return pipelineStages[0];
}

function kanbanStageDomId(stage) {
    if (stage.slug != null && stage.slug !== '') {
        return `kanban-stage-${stage.slug}`;
    }
    return `kanban-stage-${stage.id}`;
}

function kanbanColumnVisibilityKey(stage) {
    if (stage.slug != null && stage.slug !== '') {
        return String(stage.slug);
    }
    return String(stage.id);
}

function leadMatchesKanbanColumn(lead, stage) {
    const st = resolveStageForLead(lead);
    if (!st || !stage) return false;
    if (typeof normalizePipelineSlug === 'function') {
        return normalizePipelineSlug(st.slug || '') === normalizePipelineSlug(stage.slug || '');
    }
    return kanbanNumericId(st.id) === kanbanNumericId(stage.id);
}

// Load Kanban Board
async function loadKanbanBoard() {
    try {
        const searchEl = document.getElementById('leadsListSearchInput');
        const q =
            searchEl && searchEl.value && String(searchEl.value).trim()
                ? '&q=' + encodeURIComponent(String(searchEl.value).trim())
                : '';
        const response = await fetch('/api/leads?limit=5000&page=1' + q, { credentials: 'include' });
        const data = await response.json();

        scheduledVisitsRawForKanban = [];

        if (data.success && data.data) {
            allLeads = data.data;
            renderKanbanBoard();
            initKanbanDragDrop();
            bindKanbanLoadMore();
        }
    } catch (error) {
        console.error('Error loading kanban:', error);
    }
}

function getVisitScheduledPipelineStage() {
    return (
        pipelineStages.find((s) => s.slug === 'meeting_scheduled') ||
        pipelineStages.find((s) => s.slug === 'visit_scheduled') ||
        null
    );
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
    filtered.sort((a, b) => {
        const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return ta - tb;
    });
    // Um cartão por lead (próxima visita): evita duplicar no Kanban quando há várias linhas em visits
    const seenLeadIds = new Set();
    const deduped = [];
    for (const v of filtered) {
        const lid = kanbanNumericId(v.lead_id);
        if (!Number.isFinite(lid) || seenLeadIds.has(lid)) continue;
        seenLeadIds.add(lid);
        deduped.push(v);
    }
    return deduped;
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
    board.classList.add('kanban-board-grid');

    board.innerHTML = '';

    pipelineStages.forEach((stage) => {
        const stageLeads = allLeads.filter((lead) => leadMatchesKanbanColumn(lead, stage));

        const total = stageLeads.length;
        const colKey = kanbanColumnVisibilityKey(stage);
        const visibleCap =
            typeof kanbanColumnVisible[colKey] === 'number'
                ? kanbanColumnVisible[colKey]
                : KANBAN_CARDS_INITIAL;
        const visibleLeads = stageLeads.slice(0, visibleCap);
        const remaining = total - visibleLeads.length;

        const column = document.createElement('div');
        column.className = 'kanban-column';
        column.dataset.stageId =
            stage.id != null && stage.id !== '' ? String(stage.id) : '';
        column.dataset.stageSlug = stage.slug || '';

        const stageCardsId = kanbanStageDomId(stage);

        column.innerHTML = `
            <div class="kanban-column-header" style="background: ${stage.color || '#3498db'}">
                <div class="kanban-column-title">
                    <span>${escapeKanbanHtml(kanbanColumnTitle(stage))}</span>
                    <span class="kanban-column-count">${total}</span>
                </div>
            </div>
            <div class="kanban-column-cards" id="${stageCardsId}">
                ${visibleLeads.map((lead) => renderKanbanCard(lead)).join('')}
            </div>
            ${
                remaining > 0
                    ? `<div class="kanban-column-footer">
                <button type="button" class="btn btn-secondary btn-sm kanban-load-more-btn" data-stage-id="${stage.id != null && stage.id !== '' ? stage.id : ''}" data-stage-slug="${stage.slug || ''}">
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
            const slug = (btn.dataset.stageSlug || '').trim();
            if (!slug) return;
            const cur = kanbanColumnVisible[slug] ?? KANBAN_CARDS_INITIAL;
            kanbanColumnVisible[slug] = cur + KANBAN_CARDS_STEP;
            renderKanbanBoard();
            initKanbanDragDrop();
            bindKanbanLoadMore();
        });
    });
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
    const titleBtn = Number.isFinite(leadId)
        ? `<button type="button" class="kanban-card-title-btn" onclick="viewLead(${leadId})" title="Abrir lead">${name}</button>`
        : `<span class="kanban-card-title-fallback">${name}</span>`;
    return `
        <div class="kanban-card kanban-card--visit kanban-card--compact" data-lead-id="${leadIdAttr}" data-visit-id="${visit.id}">
            <div class="kanban-card-top">
                ${titleBtn}
                <span class="kanban-card-priority kanban-card-priority--chip ${priorityClass}">${priorityClass}</span>
            </div>
            <div class="kanban-card-meta kanban-card-body--visit">
                <div class="kanban-card-row"><span class="kanban-card-label">Quando</span><span class="kanban-card-value">${escapeKanbanHtml(when)}</span></div>
                <div class="kanban-card-row"><span class="kanban-card-label">Local</span><span class="kanban-card-value">${addr}</span></div>
                ${assignee ? `<div class="kanban-card-row"><span class="kanban-card-label">Resp.</span><span class="kanban-card-value">${assignee}</span></div>` : ''}
            </div>
            <div class="kanban-card-owner kanban-card-owner--hint">Arraste para outra coluna para mudar o estágio</div>
        </div>
    `;
}

// Render Kanban Card
function renderKanbanCard(lead) {
    const priorityClass = lead.priority || 'medium';
    const ownerName = escapeKanbanHtml(lead.owner_name || 'Não designado');
    const name = escapeKanbanHtml(lead.name || 'Sem nome');
    const email = lead.email ? escapeKanbanHtml(lead.email) : '';
    const phone = lead.phone ? escapeKanbanHtml(lead.phone) : '';
    const emailRow = email
        ? `<div class="kanban-card-row"><span class="kanban-card-label">Email</span><span class="kanban-card-value kanban-card-truncate" title="${email}">${email}</span></div>`
        : '';
    const phoneRow = phone
        ? `<div class="kanban-card-row"><span class="kanban-card-label">Tel.</span><span class="kanban-card-value">${phone}</span></div>`
        : '';
    const valueRow =
        lead.estimated_value != null && lead.estimated_value !== ''
            ? `<div class="kanban-card-row"><span class="kanban-card-label">Valor</span><span class="kanban-card-value">$${parseFloat(lead.estimated_value).toLocaleString()}</span></div>`
            : '';

    return `
        <div class="kanban-card kanban-card--compact" data-lead-id="${lead.id}">
            <div class="kanban-card-top">
                <button type="button" class="kanban-card-title-btn" onclick="viewLead(${lead.id})" title="Abrir lead">${name}</button>
                <span class="kanban-card-priority kanban-card-priority--chip ${priorityClass}">${priorityClass}</span>
            </div>
            <div class="kanban-card-meta">
                ${emailRow}
                ${phoneRow}
                ${valueRow}
            </div>
            <div class="kanban-card-owner">${ownerName}</div>
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

const KANBAN_SORTABLE_SHARED = {
    animation: 150,
    emptyInsertThreshold: 48,
    filter: 'button, input, textarea, select, a',
    preventOnFilter: true,
};

function setupSortable() {
    const visitsCards = document.getElementById('kanban-visits-cards');
    if (visitsCards && typeof Sortable !== 'undefined') {
        // Só o destino (colunas de estágio) trata onEnd — evita dupla chamada à API.
        // draggable nativo no HTML quebra o Sortable; não usar draggable="true" nos cartões.
        kanbanSortableInstances.push(
            new Sortable(visitsCards, {
                ...KANBAN_SORTABLE_SHARED,
                group: { name: 'kanban', pull: true, put: false },
            })
        );
    }

    pipelineStages.forEach((stage) => {
        const cardsContainer = document.getElementById(kanbanStageDomId(stage));
        if (cardsContainer) {
            kanbanSortableInstances.push(
                new Sortable(cardsContainer, {
                    ...KANBAN_SORTABLE_SHARED,
                    group: { name: 'kanban', pull: true, put: true },
                    onEnd: (evt) => {
                        if (evt.from === evt.to) return;
                        const leadId = kanbanNumericId(evt.item.dataset.leadId);
                        const col = evt.to.closest('.kanban-column');
                        if (!col || col.dataset.visitOnly === 'true') return;
                        const rawId = col.dataset.stageId;
                        const parsed = rawId ? parseInt(rawId, 10) : NaN;
                        const newStageId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
                        const newStageSlug = col.dataset.stageSlug;
                        if (Number.isFinite(leadId) && newStageSlug) {
                            void updateLeadStage(leadId, newStageId, newStageSlug);
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
            body: JSON.stringify(
                stageId != null && Number(stageId) > 0
                    ? { pipeline_stage_id: stageId, status: stageSlug }
                    : { status: stageSlug }
            )
        });
        
        const data = await response.json();
        if (data.success) {
            if (data.project_auto) {
                if (data.project_auto.created && data.project_auto.project_id) {
                    if (typeof crmNotify === 'function') {
                        crmNotify('Projeto criado (ID ' + data.project_auto.project_id + ').', 'success');
                    }
                } else if (data.project_auto.ok === false && data.project_auto.error) {
                    const msg =
                        data.project_auto.error === 'invalid_email'
                            ? 'Projeto não criado: email do lead inválido'
                            : 'Projeto não criado: ' + data.project_auto.error;
                    if (typeof crmNotify === 'function') crmNotify(msg, 'error');
                }
            }
            // Adiar reload: await dentro de onEnd do Sortable corta o teardown do drag e “prende” cartões.
            queueMicrotask(() => {
                loadKanbanBoard();
            });
            return;
        } else {
            // Revert on error
            loadKanbanBoard();
            if (typeof crmNotify === 'function') crmNotify('Erro ao atualizar estágio: ' + (data.error || 'Desconhecido'), 'error');
            else alert('Erro ao atualizar estágio: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error updating lead stage:', error);
        loadKanbanBoard();
        if (typeof crmNotify === 'function') crmNotify('Erro ao atualizar estágio', 'error');
        else alert('Erro ao atualizar estágio');
    }
}

/** Preenche o select de estágio do modal Novo Lead (inclui Visita Agendada, etc.). */
async function populateNewLeadPipelineSelect() {
    const select = document.getElementById('newLeadPipelineStage');
    if (!select) return;
    let stages = [];
    try {
        const res = await fetch('/api/pipeline-stages', { credentials: 'include' });
        const data = await res.json();
        if (data.success && Array.isArray(data.data) && typeof mergePipelineStagesForUi === 'function') {
            stages = mergePipelineStagesForUi(data.data);
        } else if (data.success && Array.isArray(data.data)) {
            stages = data.data
                .filter((s) => s.is_active !== 0)
                .sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
        }
    } catch (e) {
        /* ignore */
    }
    if (stages.length === 0) {
        stages = [
            { id: 1, slug: 'new_lead', name: 'New Lead' },
            { id: 2, slug: 'contacted', name: 'Contacted' },
            { id: 3, slug: 'meeting_scheduled', name: 'Meeting Scheduled' },
            { id: 4, slug: 'quote_sent', name: 'Quote Sent' },
            { id: 5, slug: 'follow_up_1', name: 'Follow Up 1' },
            { id: 6, slug: 'follow_up_2', name: 'Follow Up 2' },
            { id: 7, slug: 'closing_attempt', name: 'Closing Attempt' },
            { id: 8, slug: 'won', name: 'Won' },
            { id: 9, slug: 'lost', name: 'Lost' },
        ];
    }
    const prev = select.value || 'new_lead';
    select.innerHTML = '';
    stages.forEach((s) => {
        const slug = s.slug || s.name;
        if (!slug) return;
        const opt = document.createElement('option');
        opt.value = slug;
        opt.textContent =
            typeof pipelineStageDisplayName === 'function'
                ? pipelineStageDisplayName(slug, s.name)
                : s.name || slug;
        if (s.id != null) opt.dataset.stageId = String(s.id);
        select.appendChild(opt);
    });
    let found = false;
    for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === prev) {
            select.selectedIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        for (let j = 0; j < select.options.length; j++) {
            if (select.options[j].value === 'new_lead') {
                select.selectedIndex = j;
                break;
            }
        }
    }
}

// Show New Lead Modal
function showNewLeadModal() {
    loadLeadFormUsers();
    void populateNewLeadPipelineSelect();
    document.getElementById('newLeadModal').classList.add('active');
    document.getElementById('newLeadModal').style.display = 'flex';
}

// Create Lead Manually
async function createLeadManual(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const stageSelect = document.getElementById('newLeadPipelineStage');
    const stageSlug = (stageSelect && stageSelect.value) || 'new_lead';
    const stageOpt = stageSelect && stageSelect.options[stageSelect.selectedIndex];
    const stageIdRaw = stageOpt && stageOpt.dataset && stageOpt.dataset.stageId;
    const pipelineStageId = stageIdRaw ? parseInt(stageIdRaw, 10) : null;

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
        status: stageSlug,
    };
    if (Number.isFinite(pipelineStageId)) {
        leadData.pipeline_stage_id = pipelineStageId;
    }
    
    try {
        const response = await fetch('/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(leadData)
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Lead criado com sucesso!', 'success');
            else alert('Lead criado com sucesso!');
            closeModal('newLeadModal');
            form.reset();
            if (currentView === 'kanban') {
                loadKanbanBoard();
            } else {
                loadLeads();
            }
        } else {
            if (typeof crmNotify === 'function') crmNotify('Erro ao criar lead: ' + (data.error || 'Desconhecido'), 'error');
            else alert('Erro ao criar lead: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error creating lead:', error);
        if (typeof crmNotify === 'function') crmNotify('Erro ao criar lead', 'error');
        else alert('Erro ao criar lead');
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
            if (typeof crmNotify === 'function') crmNotify('Lead designado com sucesso!', 'success');
            else alert('Lead designado com sucesso!');
            closeModal('assignLeadModal');
            if (currentView === 'kanban') {
                loadKanbanBoard();
            } else {
                loadLeads();
            }
        } else {
            if (typeof crmNotify === 'function') crmNotify('Erro ao designar lead: ' + (data.error || 'Desconhecido'), 'error');
            else alert('Erro ao designar lead: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error assigning lead:', error);
        if (typeof crmNotify === 'function') crmNotify('Erro ao designar lead', 'error');
        else alert('Erro ao designar lead');
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
            if (typeof crmNotify === 'function') crmNotify('Follow-up criado com sucesso!', 'success');
            else alert('Follow-up criado com sucesso!');
            closeModal('followupModal');
            form.reset();
        } else {
            if (typeof crmNotify === 'function') crmNotify('Erro ao criar follow-up: ' + (data.error || 'Desconhecido'), 'error');
            else alert('Erro ao criar follow-up: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error creating followup:', error);
        if (typeof crmNotify === 'function') crmNotify('Erro ao criar follow-up', 'error');
        else alert('Erro ao criar follow-up');
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
    
    // Leads = só Kanban (lista desativada na UI)
    const originalLoadLeads = window.loadLeads;
    if (originalLoadLeads) {
        window.loadLeads = async function() {
            await loadLeadFormUsers();
            await loadPipelineStages();
            if (typeof loadCRMKanban === 'function') {
                await loadCRMKanban();
            } else {
                await originalLoadLeads();
            }
        };
    }
}
