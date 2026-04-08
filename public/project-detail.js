/**
 * Detalhe do projeto — abas, custos, checklist, galeria, P&L
 */
const projectId = new URLSearchParams(location.search).get('id');
let project = null;
let plData = null;
let checklistGrouped = {};
let photosByPhase = { before: [], during: [], after: [] };
let activeTab = 'overview';
let galleryUploadPhase = 'during';
/** @type {Array<{id:number,name:string,role?:string,payment_type:string,daily_rate?:number,hourly_rate?:number}>} */
let constructionPayrollRates = [];

const fmt$ = (v) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(
    parseFloat(v) || 0
  );
const fmtPct = (v) => `${(parseFloat(v) || 0).toFixed(1)}%`;

function showToast(msg, type = 'success') {
  const bg =
    type === 'error' ? 'var(--sf-bad)' : type === 'info' ? 'var(--sf-navy)' : 'var(--sf-ok)';
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;right:20px;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;color:#fff;z-index:9999;background:${bg};max-width:320px`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach((p) => {
    p.style.display = p.id === `tab-${tab}` ? 'flex' : 'none';
  });
}

async function loadProject() {
  if (!projectId) {
    window.location.href = 'projects.html';
    return;
  }
  const [projRes, plRes, checkRes, photoRes, payrollRes] = await Promise.all([
    fetch(`/api/projects/${projectId}`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/profitability`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/checklist`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/photos`, { credentials: 'include' }),
    fetch('/api/projects/lookup/construction-payroll-rates', { credentials: 'include' }),
  ]);
  const [projData, plJson, checkJson, photoJson, payrollJson] = await Promise.all([
    projRes.json(),
    plRes.json(),
    checkRes.json(),
    photoRes.json(),
    payrollRes.json().catch(() => ({})),
  ]);
  constructionPayrollRates =
    payrollJson && payrollJson.success && Array.isArray(payrollJson.data) ? payrollJson.data : [];
  if (!projRes.ok || !projData.success) {
    showToast(projData.error || 'Projeto não encontrado', 'error');
    return;
  }
  project = projData.data;
  plData = plJson.success ? plJson.data : null;
  checklistGrouped = checkJson.success && checkJson.data?.grouped ? checkJson.data.grouped : groupChecklist(project.checklist || []);
  photosByPhase =
    photoJson.success && photoJson.data
      ? photoJson.data
      : { before: [], during: [], after: [] };

  renderHeader(project);
  bindProjectSchedule(project);
  renderOverviewTab(project, plData);
  renderCostsTab(project);
  renderChecklistTab();
  renderGalleryTab();
  loadPortfolioStatusLine();
  const tb = document.getElementById('tab-btn-builder');
  if (project.client_type === 'builder' && project.builder_id) {
    if (tb) tb.style.display = '';
    await renderBuilderTab();
  } else if (tb) tb.style.display = 'none';
}

function groupChecklist(items) {
  const g = {};
  (items || []).forEach((row) => {
    const c = row.category || 'Outros';
    if (!g[c]) g[c] = [];
    g[c].push(row);
  });
  return g;
}

const STATUS_LABELS = {
  scheduled: 'Agendado',
  in_progress: 'Em andamento',
  on_hold: 'Pausado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

function fmtShortPt(iso) {
  if (!iso) return '—';
  try {
    return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return '—';
  }
}

function updateProgressDatesLine(p) {
  const el = document.getElementById('pd-prog-dates');
  if (!el) return;
  const parts = [];
  const a = fmtShortPt(p.start_date);
  const b = fmtShortPt(p.end_date_estimated);
  if (p.start_date || p.end_date_estimated) parts.push(`${a} → ${b}`);
  if (p.days_estimated != null && p.days_estimated !== '') {
    parts.push(`${parseInt(p.days_estimated, 10)} dias est.`);
  }
  const daysEst = p.days_estimated != null ? parseInt(p.days_estimated, 10) : null;
  const start = p.start_date ? new Date(`${String(p.start_date).slice(0, 10)}T12:00:00`) : null;
  if (start && daysEst) {
    const now = new Date();
    const elapsed = Math.max(1, Math.ceil((now - start) / 86400000));
    parts.push(`Dia ${elapsed}`);
  }
  el.textContent = parts.join(' · ');
}

function bindProjectSchedule(p) {
  const ds = document.getElementById('pd-date-start');
  const de = document.getElementById('pd-date-end');
  const btn = document.getElementById('pd-dates-save');
  if (ds) {
    const v = p.start_date || p.estimated_start_date;
    ds.value = v ? String(v).slice(0, 10) : '';
  }
  if (de) {
    const v = p.end_date_estimated || p.estimated_end_date;
    de.value = v ? String(v).slice(0, 10) : '';
  }
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', saveProjectSchedule);
  }
}

async function saveProjectSchedule() {
  const start = document.getElementById('pd-date-start')?.value?.trim() || '';
  const end = document.getElementById('pd-date-end')?.value?.trim() || '';
  const payload = {
    start_date: start || null,
    end_date_estimated: end || null,
  };
  if (start && end) {
    const d0 = new Date(`${start}T12:00:00`);
    const d1 = new Date(`${end}T12:00:00`);
    if (d1 >= d0) {
      payload.days_estimated = Math.round((d1 - d0) / 86400000);
    }
  }
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao guardar datas', 'error');
    return;
  }
  project = { ...project, ...j.data };
  updateProgressDatesLine(project);
  showToast('Datas guardadas');
}

function renderHeader(p) {
  document.getElementById('pd-title').textContent = p.name || `Projeto #${p.id}`;
  const crumb = document.getElementById('pd-crumb-name');
  if (crumb) crumb.textContent = 'Detalhe';

  const numEl = document.getElementById('pd-number');
  if (numEl) {
    const pn = p.project_number != null && String(p.project_number).trim() !== '' ? String(p.project_number).trim() : null;
    numEl.textContent = pn || `PRJ-${p.id}`;
  }

  const typeEl = document.getElementById('pd-client-type');
  if (typeEl) {
    const t = (p.client_type || '').toLowerCase();
    if (t === 'builder') {
      typeEl.textContent = 'Builder';
      typeEl.style.display = '';
    } else if (t === 'customer' || t) {
      typeEl.textContent = 'Cliente';
      typeEl.style.display = '';
    } else {
      typeEl.textContent = '';
      typeEl.style.display = 'none';
    }
  }

  const sel = document.getElementById('pd-status');
  if (sel && sel.options.length === 0) {
    ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'].forEach((st) => {
      const o = document.createElement('option');
      o.value = st;
      o.textContent = STATUS_LABELS[st] || st;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => updateStatus(sel.value));
  }
  if (sel) sel.value = p.status || 'scheduled';

  const pct = document.getElementById('pd-pct');
  const fill = document.getElementById('pd-progress-fill');
  if (pct) {
    pct.value = p.completion_percentage ?? 0;
    pct.onchange = () => updateCompletion(pct.value);
  }
  if (fill) fill.style.width = `${parseInt(p.completion_percentage, 10) || 0}%`;
  updateProgressDatesLine(p);
}

async function updateStatus(newStatus) {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao atualizar status', 'error');
    return;
  }
  project = { ...project, ...j.data };
  showToast('Status atualizado');
  loadProject();
}

let pctTimer;
async function updateCompletion(v) {
  clearTimeout(pctTimer);
  pctTimer = setTimeout(async () => {
    const n = Math.min(100, Math.max(0, parseInt(String(v), 10) || 0));
    await fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completion_percentage: n }),
    });
    document.getElementById('pd-progress-fill').style.width = `${n}%`;
    showToast('Progresso guardado');
  }, 400);
}

function allocProjectedForService(pr, contractVal, serviceRevenue) {
  const c = parseFloat(contractVal) || 0;
  const rev = parseFloat(serviceRevenue) || 0;
  if (!pr?.projected || c <= 0) return 0;
  return (rev / c) * (parseFloat(pr.projected.total) || 0);
}

function varianceCellClass(diff, projectedLine) {
  const d = parseFloat(diff) || 0;
  const base = parseFloat(projectedLine) || 0;
  if (d <= 0.005) return 'pd-var pd-var-ok';
  if (base > 0 && d < base * 0.1) return 'pd-var pd-var-warn';
  return 'pd-var pd-var-bad';
}

function formatCostVariance(diff, projectedLine) {
  const d = parseFloat(diff) || 0;
  const base = parseFloat(projectedLine) || 0;
  const sign = d > 0 ? '+' : '';
  const pct = base > 0 ? (d / base) * 100 : 0;
  return `${sign}${fmt$(d)} (${sign}${Math.abs(pct).toFixed(1)}%)`;
}

function serviceCardHtml(key, title, svc, pr, contractVal) {
  const rev = parseFloat(svc.revenue) || 0;
  const actual = parseFloat(svc.total_cost) || 0;
  const projected = pr ? allocProjectedForService(pr, contractVal, rev) : null;
  const profit = parseFloat(svc.gross_profit) != null ? parseFloat(svc.gross_profit) : rev - actual;
  const margin = svc.margin_pct != null ? svc.margin_pct : rev > 0 ? ((profit / rev) * 100).toFixed(1) : 0;
  const projLabel = pr && contractVal > 0 ? fmt$(projected) : '—';
  const cls =
    key === 'supply' ? 'pd-svc-card pd-svc-supply' : key === 'installation' ? 'pd-svc-card pd-svc-install' : 'pd-svc-card pd-svc-sand';
  const id =
    key === 'installation' ? 'installation' : key === 'sand_finish' ? 'sand' : 'supply';
  return `
    <div class="${cls}" id="svc-${id}">
      <div class="pd-svc-title">${title}</div>
      <div class="pd-svc-rows">
        <div class="pd-svc-row"><span>Receita</span><strong>${fmt$(rev)}</strong></div>
        <div class="pd-svc-row"><span>Custo proj.</span><strong>${projLabel}</strong></div>
        <div class="pd-svc-row"><span>Custo real</span><strong>${fmt$(actual)}</strong></div>
        <div class="pd-svc-row"><span>Lucro</span><strong class="pd-profit-val">${fmt$(profit)}</strong></div>
      </div>
      <div class="pd-svc-margin">Margem: <strong>${fmtPct(margin)}</strong></div>
    </div>`;
}

function renderOverviewTab(p, pl) {
  const el = document.getElementById('tab-overview');
  if (!el) return;
  const pr = pl?.profitability || null;
  const contractVal = parseFloat(pl?.contract_value) || parseFloat(pl?.totals?.total_revenue) || 0;
  const bs = pl?.by_service || {};
  const supply = bs.supply || {};
  const inst = bs.installation || {};
  const sand = bs.sand_finish || {};
  const totals = pl?.totals || {};
  const revenueDisplay = contractVal > 0 ? contractVal : parseFloat(totals.total_revenue) || 0;
  const gross = parseFloat(totals.gross_profit) || 0;
  const marginPct = totals.margin_pct != null ? totals.margin_pct : revenueDisplay > 0 ? ((gross / revenueDisplay) * 100).toFixed(1) : 0;
  const marginSub =
    parseFloat(marginPct) >= 35 ? 'acima da meta' : parseFloat(marginPct) >= 25 ? 'no alvo' : 'abaixo da meta';
  const profitSub = (p.status || '') === 'completed' ? 'fechado' : 'em andamento';

  let compareBlock = '';
  let daysBar = '';
  if (pr) {
    const row = (label, pj, ac) => {
      const diff = ac - pj;
      const vc = varianceCellClass(diff, pj);
      return `<div class="pd-compare-row">
        <span>${label}</span>
        <span>${fmt$(pj)}</span>
        <span>${fmt$(ac)}</span>
        <span class="${vc}">${formatCostVariance(diff, pj)}</span>
      </div>`;
    };
    compareBlock = `
    <div class="pd-compare-wrap">
      <div class="pd-compare-title">
        <span class="pd-section-dot"></span>
        Projeção vs custo real
      </div>
      <div class="pd-compare-table">
        <div class="pd-compare-header">
          <span>Item de custo</span>
          <span>Projetado</span>
          <span>Real</span>
          <span>Variação</span>
        </div>
        ${row('Labor (mão de obra)', pr.projected.labor, pr.actual.labor)}
        ${row('Material', pr.projected.material, pr.actual.material)}
        ${row('Custos adicionais', pr.projected.additional, pr.actual.additional)}
        <div class="pd-compare-row pd-compare-total">
          <span>Total</span>
          <span>${fmt$(pr.projected.total)}</span>
          <span>${fmt$(pr.actual.total)}</span>
          <span class="${varianceCellClass(pr.variance.cost_diff, pr.projected.total)}">${formatCostVariance(pr.variance.cost_diff, pr.projected.total)}</span>
        </div>
      </div>
    </div>`;

    const dEst = pr.days_estimated != null ? parseInt(pr.days_estimated, 10) : null;
    const dAct = pr.days_actual != null ? parseInt(pr.days_actual, 10) : null;
    const dVar = pr.days_variance != null ? parseInt(pr.days_variance, 10) : null;
    let varText = '—';
    let varClass = 'pd-days-num';
    if (dVar === 0) {
      varText = 'No prazo';
    } else if (dVar > 0) {
      varText = `+${dVar} dia${dVar > 1 ? 's' : ''}`;
      varClass += ' pd-days-num--warn';
    } else if (dVar < 0) {
      varText = `${dVar} dia${dVar < -1 ? 's' : ''}`;
    }
    const estRange = `${fmtShortPt(p.start_date)} → ${fmtShortPt(p.end_date_estimated)} <strong>estimado</strong>`;
    let realRange = '—';
    if (p.start_date && dAct != null && !Number.isNaN(dAct)) {
      try {
        const start = new Date(`${String(p.start_date).slice(0, 10)}T12:00:00`);
        const end = new Date(start);
        end.setDate(end.getDate() + Math.max(0, dAct - 1));
        realRange = `${fmtShortPt(p.start_date)} → ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} <strong>real</strong>`;
      } catch {
        realRange = `—`;
      }
    }

    daysBar = `
    <div class="pd-days-bar">
      <div class="pd-days-item">
        <div class="pd-days-num" id="days-estimated">${dEst != null ? dEst : '—'}</div>
        <div class="pd-days-label">Dias estimados</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-item">
        <div class="pd-days-num pd-days-num--accent" id="days-actual">${dAct != null ? dAct : '—'}</div>
        <div class="pd-days-label">Dias reais</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-item">
        <div class="${varClass}" id="days-variance">${varText}</div>
        <div class="pd-days-label">Variação</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-detail" id="days-detail">${estRange}<br />${realRange}</div>
    </div>`;
  } else if (pl && (pl.days_estimated != null || pl.days_actual != null)) {
    const dEst = pl.days_estimated != null ? parseInt(pl.days_estimated, 10) : null;
    const dAct = pl.days_actual != null ? parseInt(pl.days_actual, 10) : null;
    const dVar = pl.days_variance != null ? parseInt(pl.days_variance, 10) : null;
    let varText = '—';
    let varClass = 'pd-days-num';
    if (dVar === 0) varText = 'No prazo';
    else if (dVar > 0) {
      varText = `+${dVar} dia${dVar > 1 ? 's' : ''}`;
      varClass += ' pd-days-num--warn';
    } else if (dVar < 0) varText = `${dVar} dia${dVar < -1 ? 's' : ''}`;
    const estRange = `${fmtShortPt(p.start_date)} → ${fmtShortPt(p.end_date_estimated)} <strong>estimado</strong>`;
    daysBar = `
    <div class="pd-days-bar">
      <div class="pd-days-item">
        <div class="pd-days-num">${dEst != null ? dEst : '—'}</div>
        <div class="pd-days-label">Dias estimados</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-item">
        <div class="pd-days-num pd-days-num--accent">${dAct != null ? dAct : '—'}</div>
        <div class="pd-days-label">Dias reais</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-item">
        <div class="${varClass}">${varText}</div>
        <div class="pd-days-label">Variação</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-detail">${estRange}</div>
    </div>`;
  }

  el.innerHTML = `
    <div class="pd-overview-meta">
      <p class="pd-overview-meta__line">${escapeHtml(p.address || 'Sem endereço')} · ${escapeHtml(p.flooring_type || '—')} · ${p.total_sqft != null ? `${p.total_sqft} sqft` : '—'}</p>
      <p class="pd-overview-meta__line">Início: ${p.start_date || '—'} · Fim previsto: ${p.end_date_estimated || '—'}</p>
    </div>
    <div class="pd-service-grid" id="service-cards-grid">
      ${serviceCardHtml('supply', 'Supply', supply, pr, contractVal)}
      ${serviceCardHtml('installation', 'Installation', inst, pr, contractVal)}
      ${serviceCardHtml('sand_finish', 'Sand &amp; Finish', sand, pr, contractVal)}
    </div>
    <div class="pd-totals-card">
      <div class="pd-total-item">
        <div class="pd-total-label">Receita total</div>
        <div class="pd-total-val" id="total-revenue">${fmt$(revenueDisplay)}</div>
        <div class="pd-total-sub">valor do contrato</div>
      </div>
      <div class="pd-total-item">
        <div class="pd-total-label">Custo total</div>
        <div class="pd-total-val" id="total-cost">${fmt$(totals.total_cost)}</div>
        <div class="pd-total-sub" id="total-cost-sub">real até agora</div>
      </div>
      <div class="pd-total-item">
        <div class="pd-total-label">Lucro bruto</div>
        <div class="pd-total-val pd-total-ok" id="total-profit">${fmt$(gross)}</div>
        <div class="pd-total-sub" id="total-profit-sub">${profitSub}</div>
      </div>
      <div class="pd-total-item">
        <div class="pd-total-label">Margem</div>
        <div class="pd-total-val pd-total-ok" id="total-margin">${fmtPct(marginPct)}</div>
        <div class="pd-total-sub" id="total-margin-sub">${marginSub}</div>
      </div>
    </div>
    ${compareBlock}
    ${daysBar}
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function renderCostsTab(p) {
  const el = document.getElementById('tab-costs');
  if (!el) return;
  const costs = p.costs || [];
  const labor = costs.filter((c) => c.cost_type === 'labor');
  const additional = costs.filter((c) => c.cost_type === 'additional');
  const materials = p.materials || [];
  const sumLabor = labor.reduce((a, x) => a + (parseFloat(x.total_cost) || 0), 0);
  const sumAdd = additional.reduce((a, x) => a + (parseFloat(x.total_cost) || 0), 0);
  const sumMat = materials.reduce((a, x) => a + (parseFloat(x.total_cost) || 0), 0);
  const grand = sumLabor + sumAdd + sumMat;
  el.innerHTML = `
    <button type="button" class="pd-btn pd-btn--primary" id="btn-sync-payroll-tab" style="margin-bottom:14px">🔄 Importar da folha de pagamento</button>
    <p style="font-weight:700;color:var(--sf-navy);margin-bottom:12px">Total custos: ${fmt$(grand)}</p>
    ${costSection('labor', 'Mão de obra (labor)', labor, sumLabor, 'labor', null, constructionPayrollRates)}
    ${costSection('material', 'Materiais (stock)', [], sumMat, 'material', materials)}
    ${costSection('additional', 'Adicional', additional, sumAdd, 'additional')}
  `;
  el.querySelectorAll('.pd-collapsible-h').forEach((h) => {
    h.addEventListener('click', () => h.closest('.pd-collapsible').classList.toggle('open'));
  });
  wireCostForms(el, p);
  document.getElementById('btn-sync-payroll-tab')?.addEventListener('click', syncPayroll);
}

function costSection(key, title, rows, sum, type, matRows, payrollEmployees) {
  const isMat = type === 'material';
  const list = isMat ? matRows : rows;
  const matExtra =
    isMat
      ? `<div class="pd-inline-form pd-mat-general" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--sf-border)">
    <p style="grid-column:1/-1;font-size:13px;color:var(--sf-muted);margin:0 0 4px">Custos gerais de materiais (valor único, ex. consumíveis diversos)</p>
    ${materialGeneralFormFields()}
    <button type="button" class="pd-btn pd-btn--primary" style="grid-column:1/-1" data-submit-general-material>+ Adicionar custo geral</button>
  </div>`
      : '';
  return `
    <div class="pd-collapsible open" data-section="${key}">
      <div class="pd-collapsible-h"><span>${title}</span><span>${fmt$(sum)}</span></div>
      <div class="pd-collapsible-b">
        <table class="pd-table">
          <thead><tr><th>Descrição</th><th>Cat.</th><th>Qtd</th><th>Un.</th><th>Unit</th><th>Total</th>${isMat ? '<th>Status</th>' : '<th>Pago</th>'}<th></th></tr></thead>
          <tbody>
            ${list.length ? list.map((r) => costRowHtml(r, isMat)).join('') : '<tr><td colspan="8" style="color:var(--sf-muted)">Sem itens</td></tr>'}
          </tbody>
        </table>
        <div class="pd-inline-form" data-add="${type}">
          ${isMat ? materialFormFields() : type === 'labor' ? laborFormFields(payrollEmployees || []) : additionalFormFields()}
          <button type="button" class="pd-btn pd-btn--primary" style="grid-column:1/-1" data-submit-cost="${type}">+ Adicionar</button>
        </div>
        ${matExtra}
      </div>
    </div>`;
}

function laborFormFields(employees) {
  const opts =
    employees && employees.length
      ? employees
          .map((e) => {
            const pt = e.payment_type || 'daily';
            const hint = pt === 'hourly' ? 'hora' : pt === 'mixed' ? 'misto' : 'diária';
            const label = `${e.name || ''}${e.role ? ' — ' + e.role : ''} (${hint})`;
            const dr = parseFloat(e.daily_rate) || 0;
            const hr = parseFloat(e.hourly_rate) || 0;
            return `<option value="${e.id}" data-payment="${escapeHtml(pt)}" data-daily="${dr}" data-hourly="${hr}" data-name="${escapeHtml(e.name || '')}">${escapeHtml(label)}</option>`;
          })
          .join('')
      : '';
  const payrollHint =
    employees && employees.length
      ? ''
      : '<p style="grid-column:1/-1;font-size:12px;color:var(--sf-muted);margin:0">Nenhum funcionário ativo na folha de construção — preencha custo e unidade manualmente.</p>';
  return `
    <select data-f="payroll_pick" style="grid-column:1/-1">
      <option value="">— Funcionário (folha) / aplicar diária ou hora —</option>
      ${opts}
    </select>
    ${payrollHint}
    <select data-f="is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <input type="text" data-f="description" placeholder="Descrição" />
    <input type="number" data-f="quantity" placeholder="Qtd (ex. nº de diárias)" step="0.01" value="1" />
    <input type="text" data-f="unit" placeholder="Unidade (dias, h…)" />
    <input type="number" data-f="unit_cost" placeholder="Custo unit. (preenche pela folha)" step="0.01" />
    <select data-f="service_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>`;
}

function materialGeneralFormFields() {
  return `
    <select data-f="general_is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <input type="number" data-f="general_total" placeholder="Valor total ($)" step="0.01" min="0" />
    <select data-f="general_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>
    <input type="text" data-f="general_notes" placeholder="Notas (opcional)" style="grid-column:1/-1" />`;
}

function materialFormFields() {
  return `
    <select data-f="is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <input type="text" data-f="product_name" placeholder="Produto" />
    <input type="text" data-f="supplier" placeholder="Fornecedor" />
    <input type="number" data-f="qty_ordered" placeholder="Qtd pedida" step="0.01" />
    <input type="number" data-f="qty_received" placeholder="Qtd recebida" step="0.01" />
    <input type="number" data-f="qty_used" placeholder="Qtd usada" step="0.01" />
    <input type="number" data-f="unit_cost" placeholder="Custo unit." step="0.01" />
    <select data-f="service_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>`;
}

function additionalFormFields() {
  return `
    <select data-f="is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <input type="text" data-f="description" placeholder="Descrição" style="grid-column:span 2" />
    <input type="number" data-f="quantity" placeholder="Qtd" step="0.01" value="1" />
    <input type="number" data-f="unit_cost" placeholder="Valor total como unit*qtd" step="0.01" />
    <select data-f="service_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>
    <input type="text" data-f="vendor" placeholder="Vendor" />`;
}

function costRowHtml(r, isMat) {
  if (isMat) {
    const proj = r.is_projected === 1 || r.is_projected === true ? ' <small>(proj.)</small>' : '';
    return `<tr>
      <td>${escapeHtml(r.product_name)}${proj}</td><td>${escapeHtml(r.service_category)}</td>
      <td>${r.qty_ordered}</td><td>${escapeHtml(r.unit || '')}</td><td>${fmt$(r.unit_cost)}</td><td>${fmt$(r.total_cost)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td></td></tr>`;
  }
  const proj = r.is_projected === 1 || r.is_projected === true ? ' <small>(proj.)</small>' : '';
  return `<tr>
    <td>${escapeHtml(r.description)}${proj}</td><td>${escapeHtml(r.service_category)}</td>
    <td>${r.quantity}</td><td>${escapeHtml(r.unit || '')}</td><td>${fmt$(r.unit_cost)}</td><td>${fmt$(r.total_cost)}</td>
    <td>${r.paid ? 'Sim' : 'Não'}</td>
    <td><button type="button" class="pd-btn" data-del-cost="${r.id}">✕</button></td></tr>`;
}

function wirePayrollPick(root) {
  root.querySelectorAll('[data-f="payroll_pick"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      if (!opt || !sel.value) return;
      const form = sel.closest('.pd-inline-form');
      if (!form) return;
      const pt = (opt.getAttribute('data-payment') || 'daily').toLowerCase();
      const daily = parseFloat(opt.getAttribute('data-daily')) || 0;
      const hourly = parseFloat(opt.getAttribute('data-hourly')) || 0;
      const uc = form.querySelector('[data-f="unit_cost"]');
      const u = form.querySelector('[data-f="unit"]');
      const desc = form.querySelector('[data-f="description"]');
      if (pt === 'hourly') {
        if (uc) uc.value = hourly > 0 ? String(hourly) : '';
        if (u) u.value = 'h';
      } else if (pt === 'mixed') {
        if (daily > 0) {
          if (uc) uc.value = String(daily);
          if (u) u.value = 'dias';
        } else if (hourly > 0) {
          if (uc) uc.value = String(hourly);
          if (u) u.value = 'h';
        }
      } else {
        if (uc) uc.value = daily > 0 ? String(daily) : '';
        if (u) u.value = 'dias';
      }
      const name = opt.getAttribute('data-name') || '';
      if (desc && name && !String(desc.value).trim()) desc.value = name;
    });
  });
}

function wireCostForms(root) {
  wirePayrollPick(root);
  root.querySelectorAll('[data-submit-general-material]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const form = btn.closest('.pd-mat-general');
      const get = (name) => form?.querySelector(`[data-f="${name}"]`)?.value;
      const total = parseFloat(get('general_total')) || 0;
      if (total <= 0) {
        showToast('Informe o valor total dos custos gerais', 'error');
        return;
      }
      const body = {
        product_name: 'Custos gerais de materiais',
        unit: 'total',
        qty_ordered: 1,
        qty_received: 0,
        qty_used: 0,
        unit_cost: total,
        service_category: get('general_category') || 'general',
        notes: get('general_notes')?.trim() || null,
        is_projected: get('general_is_projected') === '1',
      };
      const res = await fetch(`/api/projects/${projectId}/materials`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.success) showToast(j.error || 'Erro', 'error');
      else {
        showToast('Custo geral de materiais adicionado');
        form.querySelector('[data-f="general_total"]').value = '';
        const n = form.querySelector('[data-f="general_notes"]');
        if (n) n.value = '';
      }
      loadProject();
    });
  });
  root.querySelectorAll('[data-submit-cost]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const type = btn.getAttribute('data-submit-cost');
      const form = btn.closest('.pd-inline-form');
      const get = (name) => form.querySelector(`[data-f="${name}"]`)?.value;
      if (type === 'material') {
        const body = {
          product_name: get('product_name'),
          supplier: get('supplier') || null,
          qty_ordered: get('qty_ordered') || 0,
          qty_received: get('qty_received') || 0,
          qty_used: get('qty_used') || 0,
          unit_cost: get('unit_cost') || 0,
          service_category: get('service_category') || 'general',
          is_projected: get('is_projected') === '1',
        };
        const res = await fetch(`/api/projects/${projectId}/materials`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok || !j.success) showToast(j.error || 'Erro', 'error');
        else showToast('Material adicionado');
      } else {
        const body = {
          cost_type: type,
          description: get('description') || 'Item',
          quantity: get('quantity') || 1,
          unit: get('unit') || null,
          unit_cost: get('unit_cost') || 0,
          service_category: get('service_category') || 'general',
          vendor: get('vendor') || null,
          is_projected: get('is_projected') === '1',
        };
        const res = await fetch(`/api/projects/${projectId}/costs`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok || !j.success) showToast(j.error || 'Erro', 'error');
        else showToast('Custo adicionado');
      }
      loadProject();
    });
  });
  root.querySelectorAll('[data-del-cost]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.getAttribute('data-del-cost');
      await fetch(`/api/projects/${projectId}/costs/${id}`, { method: 'DELETE', credentials: 'include' });
      loadProject();
    });
  });
}

function renderChecklistTab() {
  const el = document.getElementById('tab-checklist');
  if (!el) return;
  const items = Object.values(checklistGrouped).flat();
  const total = items.length;
  const done = items.filter((i) => i.checked === 1 || i.checked === true).length;
  const banner =
    project.checklist_completed && project.checklist_completed_at
      ? `<div class="pd-banner-ok">Vistoria concluída ✓ ${escapeHtml(String(project.checklist_completed_at).slice(0, 16))}</div>`
      : '';
  el.innerHTML = `
    ${banner}
    <p style="font-size:13px;margin-bottom:8px"><strong>${done}</strong> de <strong>${total}</strong> itens</p>
    <div style="height:8px;background:rgba(26,32,54,.1);border-radius:6px;margin-bottom:12px"><div style="height:100%;width:${total ? (done / total) * 100 : 0}%;background:var(--sf-ok);border-radius:6px"></div></div>
    <button type="button" class="pd-btn" id="btn-check-all" style="margin-bottom:14px">Marcar todos como concluído</button>
    <div id="checklist-groups"></div>
  `;
  const host = document.getElementById('checklist-groups');
  Object.keys(checklistGrouped)
    .sort()
    .forEach((cat) => {
      const wrap = document.createElement('div');
      wrap.className = 'pd-check-cat';
      wrap.innerHTML = `<h4>${escapeHtml(cat)}</h4>`;
      checklistGrouped[cat].forEach((item) => {
        const block = document.createElement('div');
        block.style.marginBottom = '10px';
        const row = document.createElement('div');
        row.className = 'pd-check-item';
        const checked = item.checked === 1 || item.checked === true;
        row.innerHTML = `
          <input type="checkbox" id="chk-${item.id}" data-item-id="${item.id}" ${checked ? 'checked' : ''} />
          <label for="chk-${item.id}" style="flex:1;cursor:pointer;font-size:13px">${escapeHtml(item.item)}</label>
          <button type="button" class="pd-btn" data-toggle-note="${item.id}" aria-label="Nota">▾</button>`;
        const note = document.createElement('div');
        note.style.cssText = 'display:none;width:100%;margin-top:4px;padding-left:28px;box-sizing:border-box';
        note.innerHTML = `<textarea data-note="${item.id}" rows="2" style="width:100%;border-radius:6px;border:1px solid var(--sf-border);padding:6px;box-sizing:border-box" placeholder="Nota">${escapeHtml(item.notes || '')}</textarea><button type="button" class="pd-btn" data-save-note="${item.id}" style="margin-top:4px">Guardar nota</button>`;
        block.appendChild(row);
        block.appendChild(note);
        wrap.appendChild(block);
        row.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
          toggleChecklistItem(item.id, e.target.checked);
        });
        row.querySelector('[data-toggle-note]')?.addEventListener('click', () => {
          note.style.display = note.style.display === 'none' ? 'block' : 'none';
        });
        note.querySelector('[data-save-note]')?.addEventListener('click', async () => {
          const txt = block.querySelector(`[data-note="${item.id}"]`)?.value;
          await fetch(`/api/projects/${projectId}/checklist/${item.id}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checked: row.querySelector('input[type=checkbox]').checked, notes: txt }),
          });
          showToast('Nota guardada');
        });
      });
      host.appendChild(wrap);
    });
  document.getElementById('btn-check-all')?.addEventListener('click', async () => {
    if (!confirm('Marcar todos os itens como concluídos?')) return;
    for (const it of items) {
      await fetch(`/api/projects/${projectId}/checklist/${it.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked: true }),
      });
    }
    showToast('Checklist atualizado');
    loadProject();
  });
}

async function toggleChecklistItem(itemId, checked) {
  await fetch(`/api/projects/${projectId}/checklist/${itemId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checked }),
  });
  loadProject();
}

function renderGalleryTab() {
  const el = document.getElementById('tab-gallery');
  if (!el) return;
  el.innerHTML = `
    <div class="pd-gallery-page-grid">
      ${galleryCol('before', 'Antes')}
      ${galleryCol('during', 'Durante')}
      ${galleryCol('after', 'Depois')}
    </div>
    <div class="pd-portfolio-panel" id="portfolio-panel">
      <div class="pd-section-header" style="margin-bottom:14px">
        <div class="pd-section-title-row">
          <span class="pd-section-dot"></span>
          <span class="pd-section-title">Publicar no portfólio Senior Floors</span>
        </div>
      </div>
      <div class="pd-portfolio-form">
        <div class="pd-portfolio-form-row">
          <label class="pd-label" for="portfolio-title">Título</label>
          <input type="text" class="pd-input" id="portfolio-title" placeholder="Ex.: Hardwood Installation — Naples, FL" />
        </div>
        <div class="pd-portfolio-form-row">
          <label class="pd-label" for="portfolio-desc">Descrição</label>
          <textarea class="pd-input pd-textarea" id="portfolio-desc" placeholder="Descreva o projeto para o portfólio…"></textarea>
        </div>
        <p class="pd-portfolio-info" id="portfolio-selected-count">Fotos para portfólio: 0</p>
        <div class="pd-portfolio-actions">
          <button type="button" class="pd-btn-primary" id="btn-publish-portfolio">🌐 Publicar no site</button>
          <button type="button" class="pd-action-btn" id="btn-copy-photo-urls">📋 Copiar URLs</button>
        </div>
        <p id="portfolio-live-status" style="font-size:12px;font-weight:600;color:var(--sf-ok);min-height:1.25em"></p>
        <p class="pd-portfolio-webhook-note" id="portfolio-hint">
          Sem webhook: copie as URLs e publique manualmente em <a href="https://senior-floors.com" target="_blank" rel="noopener">senior-floors.com</a>. Configure <code>PORTFOLIO_WEBHOOK_URL</code> no servidor para sync automático.
        </p>
      </div>
    </div>`;
  el.querySelectorAll('.pd-add-photo').forEach((box) => {
    box.addEventListener('click', () => {
      galleryUploadPhase = box.getAttribute('data-phase') || 'during';
      document.getElementById('pd-file-input').click();
    });
  });
  el.querySelectorAll('.pd-gallery-photos img').forEach((img) => {
    img.addEventListener('click', () => {
      const all = flattenPhotos();
      const idx = all.findIndex((x) => x.url === img.getAttribute('src'));
      openLightbox(all, idx >= 0 ? idx : 0);
    });
  });
  function refreshPortfolioCount() {
    const n = el.querySelectorAll('.photo-select:checked').length;
    const c = document.getElementById('portfolio-selected-count');
    if (c) c.textContent = `Fotos para portfólio: ${n}`;
  }
  el.querySelectorAll('.photo-select').forEach((cb) => {
    cb.addEventListener('change', refreshPortfolioCount);
  });
  refreshPortfolioCount();
  el.querySelectorAll('.pd-set-cover').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCoverPhoto(btn.getAttribute('data-photo-id'));
    });
  });
  document.getElementById('btn-publish-portfolio')?.addEventListener('click', publishPortfolio);
  document.getElementById('btn-copy-photo-urls')?.addEventListener('click', copyPhotoUrls);
}

function galleryCol(phase, label) {
  const list = photosByPhase[phase] || [];
  const thumbs = list
    .map((ph) => {
      const sel = ph.is_portfolio === 1 || ph.is_portfolio === true ? ' checked' : '';
      return `<div style="display:flex;flex-direction:column;gap:4px">
        <img src="${escapeHtml(ph.url)}" alt="" data-photo-id="${ph.id}" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer" />
        <label style="font-size:10px;display:flex;align-items:center;gap:4px;color:var(--sf-muted)">
          <input type="checkbox" class="photo-select" data-photo-id="${ph.id}"${sel} /> Portfólio
        </label>
        <button type="button" class="pd-btn pd-set-cover" data-photo-id="${ph.id}" style="font-size:10px;padding:4px 6px">⭐ Capa</button>
      </div>`;
    })
    .join('');
  return `<div class="pd-gallery-col" id="gallery-${phase}">
    <div class="pd-gallery-col-header">
      <span class="pd-gallery-col-title">${label}</span>
      <span class="pd-gallery-count">${list.length} foto${list.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="pd-gallery-photos">${thumbs}</div>
    <div class="pd-add-photo" data-phase="${phase}" role="button" tabindex="0">+ Adicionar foto</div>
  </div>`;
}

function flattenPhotos() {
  return [...(photosByPhase.before || []), ...(photosByPhase.during || []), ...(photosByPhase.after || [])];
}

function openLightbox(photos, index) {
  let curr = index;
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:16px';
  const cap = document.createElement('div');
  cap.style.cssText = 'color:rgba(255,255,255,.7);font-size:12px';
  const img = document.createElement('img');
  img.style.cssText = 'max-width:90vw;max-height:75vh;object-fit:contain;border-radius:8px';
  const nav = document.createElement('div');
  nav.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center';
  function render() {
    const p = photos[curr];
    img.src = p.url;
    cap.textContent = `${p.caption || ''} ${curr + 1}/${photos.length}`;
    nav.innerHTML = '';
    if (curr > 0) {
      const b = document.createElement('button');
      b.textContent = '← Anterior';
      b.style.cssText =
        'padding:8px 18px;background:rgba(255,255,255,.12);border:none;border-radius:8px;color:#fff;cursor:pointer';
      b.onclick = () => {
        curr--;
        render();
      };
      nav.appendChild(b);
    }
    const close = document.createElement('button');
    close.textContent = '✕ Fechar';
    close.style.cssText =
      'padding:8px 18px;background:rgba(255,255,255,.12);border:none;border-radius:8px;color:#fff;cursor:pointer';
    close.onclick = () => document.body.removeChild(overlay);
    nav.appendChild(close);
    if (curr < photos.length - 1) {
      const n = document.createElement('button');
      n.textContent = 'Próxima →';
      n.style.cssText =
        'padding:8px 18px;background:rgba(255,255,255,.12);border:none;border-radius:8px;color:#fff;cursor:pointer';
      n.onclick = () => {
        curr++;
        render();
      };
      nav.appendChild(n);
    }
    const del = document.createElement('button');
    del.textContent = 'Eliminar foto';
    del.style.cssText =
      'padding:8px 18px;background:rgba(143,32,32,.6);border:none;border-radius:8px;color:#fff;cursor:pointer';
    del.onclick = async () => {
      if (!confirm('Remover esta foto?')) return;
      await fetch(`/api/projects/${projectId}/photos/${p.id}`, { method: 'DELETE', credentials: 'include' });
      document.body.removeChild(overlay);
      loadProject();
    };
    nav.appendChild(del);
  }
  overlay.appendChild(img);
  overlay.appendChild(cap);
  overlay.appendChild(nav);
  render();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });
  document.body.appendChild(overlay);
}

async function uploadPhoto(file, phase) {
  const form = new FormData();
  form.append('file', file);
  form.append('phase', phase);
  showToast(`A enviar ${file.name}…`, 'info');
  const res = await fetch(`/api/projects/${projectId}/photos`, { method: 'POST', credentials: 'include', body: form });
  if (res.ok) {
    showToast('Foto enviada ✓');
    loadProject();
  } else {
    const j = await res.json().catch(() => ({}));
    showToast(j.error || 'Erro ao enviar foto', 'error');
  }
}

async function syncPayroll() {
  const btn = document.getElementById('btn-sync-payroll');
  const tabBtn = document.getElementById('btn-sync-payroll-tab');
  const busy = btn || tabBtn;
  if (busy) {
    busy.disabled = true;
    busy.textContent = 'Sincronizando…';
  }
  try {
    const res = await fetch(`/api/projects/${projectId}/costs/sync-payroll`, {
      method: 'POST',
      credentials: 'include',
    });
    const j = await res.json();
    if (res.ok && j.success) {
      if (j.synced > 0) {
        showToast(`${j.synced} lançamento(s) importado(s) da folha de pagamento`);
        loadProject();
      } else {
        showToast('Nenhum lançamento novo na folha de pagamento', 'info');
      }
    } else {
      showToast(j.error || 'Erro ao sincronizar', 'error');
    }
  } catch (e) {
    showToast('Erro de rede', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Payroll';
    }
    if (tabBtn) {
      tabBtn.disabled = false;
      tabBtn.textContent = '🔄 Importar da folha de pagamento';
    }
  }
}

async function setCoverPhoto(photoId) {
  const id = parseInt(String(photoId), 10);
  if (!id) return;
  const res = await fetch(`/api/projects/${projectId}/photos/${id}/cover`, {
    method: 'PUT',
    credentials: 'include',
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao definir capa', 'error');
    return;
  }
  showToast('Foto de capa atualizada');
}

async function publishPortfolio() {
  const selected = [...document.querySelectorAll('.photo-select:checked')].map((c) =>
    parseInt(c.getAttribute('data-photo-id'), 10)
  );
  const title = document.getElementById('portfolio-title')?.value?.trim() || `Project #${projectId}`;
  const description = document.getElementById('portfolio-desc')?.value?.trim() || '';
  if (!selected.length) {
    showToast('Selecione ao menos uma foto', 'error');
    return;
  }
  const btn = document.getElementById('btn-publish-portfolio');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'A publicar…';
  }
  try {
    const res = await fetch(`/api/projects/${projectId}/portfolio/publish`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_ids: selected, title, description }),
    });
    const j = await res.json();
    if (res.ok && j.success) {
      showToast(
        j.data?.webhook_sent ? 'Publicado (webhook enviado) ✓' : 'Fotos marcadas — configure o webhook para sync automático',
        j.data?.webhook_sent ? 'success' : 'info'
      );
      loadProject();
    } else {
      showToast(j.error || 'Erro ao publicar', 'error');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🌐 Publicar no site';
    }
  }
}

async function copyPhotoUrls() {
  const all = flattenPhotos();
  const urls = all.map((p) => `${location.origin}${p.url}`).join('\n');
  try {
    await navigator.clipboard.writeText(urls);
    showToast('URLs copiadas');
  } catch (_) {
    showToast('Não foi possível copiar', 'error');
  }
}

async function loadPortfolioStatusLine() {
  const live = document.getElementById('portfolio-live-status');
  if (!live) return;
  try {
    const r = await fetch(`/api/projects/${projectId}/portfolio/status`, { credentials: 'include' });
    const j = await r.json();
    const d = j.data || {};
    if (d.portfolio_published) {
      const when = d.portfolio_published_at ? String(d.portfolio_published_at).slice(0, 10) : '';
      live.textContent = when ? `🌐 Publicado em ${when}` : '🌐 Publicado no portfólio';
    } else {
      live.textContent = project?.portfolio_published ? '🌐 Publicado no portfólio' : '';
    }
  } catch (_) {}
}

async function renderBuilderTab() {
  const el = document.getElementById('tab-builder');
  if (!el || !project.builder_id) return;
  const res = await fetch(`/api/projects/builder/${project.builder_id}`, { credentials: 'include' });
  const j = await res.json();
  if (!j.success) {
    el.innerHTML = '<p>Não foi possível carregar dados do builder.</p>';
    return;
  }
  const b = j.data.builder;
  const agg = j.data.aggregates || {};
  const projs = j.data.projects || [];
  el.innerHTML = `
    <div class="sf-card" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px;color:var(--sf-navy)">${escapeHtml(b?.name || 'Builder')}</h3>
      <p style="margin:0;font-size:13px;color:var(--sf-muted)">${escapeHtml(b?.email || '')} ${escapeHtml(b?.phone || '')}</p>
      <p style="margin:8px 0 0;font-size:13px">${escapeHtml(b?.address || '')}</p>
    </div>
    <div class="sf-card" style="margin-bottom:12px;font-size:13px;font-weight:600">
      ${agg.project_count || 0} projetos · ${fmt$(agg.total_sqft)} sqft · Receita ${fmt$(agg.total_revenue)} · Lucro ${fmt$(agg.total_profit)} · Margem média ${fmtPct(agg.avg_margin_pct)}
    </div>
    <table class="pd-table" style="background:#fff;border-radius:8px">
      <thead><tr><th>Projeto</th><th>Status</th><th>Valor</th></tr></thead>
      <tbody>
        ${projs.map((p) => `<tr style="cursor:pointer" data-go="${p.id}"><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.status)}</td><td>${fmt$(p.contract_value)}</td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('tr[data-go]').forEach((tr) => {
    tr.addEventListener('click', () => {
      window.location.href = `/project-detail.html?id=${tr.getAttribute('data-go')}`;
    });
  });
}

document.getElementById('pd-file-input')?.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) uploadPhoto(f, galleryUploadPhase);
});

document.querySelectorAll('.tab-btn').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

document.getElementById('btn-tab-gallery')?.addEventListener('click', () => switchTab('gallery'));

function goToPublishPanel() {
  switchTab('gallery');
  requestAnimationFrame(() => {
    document.getElementById('portfolio-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-sync-payroll')?.addEventListener('click', syncPayroll);
  document.getElementById('btn-pd-publish')?.addEventListener('click', goToPublishPanel);
  fetch('/api/auth/session', { credentials: 'include' }).then(async (r) => {
    const j = await r.json();
    if (!j.authenticated) {
      window.location.href = '/login.html';
      return;
    }
    loadProject();
  });
});
