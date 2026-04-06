/**
 * Construction payroll UI — /payroll-module.html
 */
const CP = '/api/construction-payroll';

let canManage = false;
/** Lançar/guardar linhas do quadro: quem entra nesta página já tem payroll.view */
let canEditTimesheet = false;
let role = '';
let permissionKeys = [];
let employees = [];
let employeesById = {};
let periods = [];
let projects = [];
let selectedPeriodId = null;

/** IDs vindos da API podem ser string/número — comparar sempre normalizado */
function periodIdNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
let currentPeriod = null;
let timesheetRows = [];
let closingPeriodMode = false;
let employeeAggRefreshTimer = null;
/** AbortController para totais em tempo real no modal de fecho (reembolso/desconto) */
let previewAdjustmentsLiveAbort = null;

/** Período em edição: API (currentPeriod) ou fallback à lista (evita esconder botões se o GET falhar). */
function selectedPeriodRecord() {
  const sid = periodIdNum(selectedPeriodId);
  if (sid == null) return null;
  if (currentPeriod != null && periodIdNum(currentPeriod.id) === sid) return currentPeriod;
  return periods.find((x) => periodIdNum(x.id) === sid) || null;
}

/** Alterar linhas já guardadas (dias/horas): aberto + payroll.view; fechado só payroll.manage */
function canEditTimesheetGrid() {
  const p = selectedPeriodRecord();
  if (!p) return false;
  if (p.status === 'closed') return canManage;
  return canEditTimesheet;
}

/** + Linha só com período aberto */
function canAddTimesheetRows() {
  const p = selectedPeriodRecord();
  if (!p || p.status === 'closed') return false;
  return canEditTimesheet;
}

function sectorLabel(s) {
  if (s === 'installation') return 'Installation';
  if (s === 'sand_finish') return 'Sand & Finish';
  return '—';
}

function money(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(x);
}

/** Quantidades no relatório (diárias, horas) — até 2 casas, sem forçar zeros à direita desnecessários */
function fmtReportQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(x);
}

const EMPLOYEE_REPORT_HEADERS = [
  'Funcionário',
  'Setor',
  'Diárias',
  'H. Extras',
  'Valor',
  'Reembolso',
  'Descontos',
  'Total',
];

function calcLinePreview(empId, row) {
  const emp = employeesById[empId];
  if (!emp) return 0;
  const pt = String(emp.payment_type || 'daily').toLowerCase();
  const ovr = row.daily_rate_override;
  const hasOvr = ovr !== undefined && ovr !== null && String(ovr).trim() !== '';
  const drNum = hasOvr ? Number(ovr) : Number(emp.daily_rate) || 0;
  const dr = Number.isFinite(drNum) && drNum >= 0 ? drNum : Number(emp.daily_rate) || 0;
  const hr = Number(emp.hourly_rate) || 0;
  const ort = Number(emp.overtime_rate) || 0;
  const d = Number(row.days_worked) || 0;
  const rh = Number(row.regular_hours) || 0;
  const ot = Number(row.overtime_hours) || 0;
  let base = 0;
  if (pt === 'hourly') base = (rh > 0 ? rh : d) * hr;
  else if (pt === 'mixed') base = d * dr + rh * hr;
  else base = d * dr;
  return Math.round((base + ot * ort) * 100) / 100;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${CP}${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (j.code === 'PAYROLL_SCHEMA_MISSING') {
    document.getElementById('migrateBanner')?.classList.remove('hidden');
  }
  if (!r.ok) {
    const err = new Error(j.error || r.statusText || 'Request failed');
    err.status = r.status;
    err.payload = j;
    throw err;
  }
  return j;
}

function showAuth(msg) {
  const el = document.getElementById('authMsg');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function setManageUi() {
  const show = canManage;
  ['btnNewEmployee', 'btnNewPeriod', 'btnNewEmployeeEmpty'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  });
  document.getElementById('quickEmpPanel')?.classList.toggle('hidden', !show);
  const readOnlyNote = document.getElementById('equipaReadOnlyNote');
  if (readOnlyNote) {
    const hasView = String(role || '').toLowerCase() === 'admin' || permissionKeys.includes('payroll.view');
    readOnlyNote.classList.toggle('hidden', canManage || !hasView);
  }
  refreshPeriodActions();
}

function refreshPeriodActions() {
  const p = selectedPeriodRecord();
  const delBtn = document.getElementById('btnDeletePeriod');
  if (!p) {
    ['btnPreviewClose', 'btnReopenPeriod', 'btnAddTimesheetRow', 'btnSaveTimesheet'].forEach((id) =>
      document.getElementById(id)?.classList.add('hidden')
    );
    delBtn?.classList.add('hidden');
    return;
  }
  const showSave = canEditTimesheetGrid();
  const showAdd = canAddTimesheetRows();
  document.getElementById('btnSaveTimesheet')?.classList.toggle('hidden', !showSave);
  document.getElementById('btnAddTimesheetRow')?.classList.toggle('hidden', !showAdd);
  const periodClosed = p.status === 'closed';
  document.getElementById('btnPreviewClose')?.classList.toggle('hidden', !(canManage && !periodClosed));
  document.getElementById('btnReopenPeriod')?.classList.toggle('hidden', !(canManage && periodClosed));
  delBtn?.classList.toggle('hidden', !canManage);
}

async function loadSession() {
  const r = await fetch('/api/auth/session', { credentials: 'include' });
  const j = await r.json();
  if (!j.authenticated) {
    window.location.href = '/login.html';
    return false;
  }
  if (j.user?.must_change_password) {
    window.location.href = '/change-password.html';
    return false;
  }
  role = j.user?.role || '';
  permissionKeys = Array.isArray(j.user?.permissions)
    ? [...new Set(j.user.permissions.map((k) => String(k).trim()).filter(Boolean))]
    : [];
  const isAdmin = String(role || '').toLowerCase() === 'admin';
  const hasView = isAdmin || permissionKeys.includes('payroll.view');
  canManage = isAdmin || permissionKeys.includes('payroll.manage');
  canEditTimesheet = hasView;
  if (!hasView) {
    showAuth('Sem permissão payroll.view para ver esta página.');
    return false;
  }
  showAuth('');
  setManageUi();
  return true;
}

async function loadDashboard() {
  try {
    const j = await api('GET', '/dashboard/summary');
    const d = j.data || {};
    document.getElementById('dashActiveEmp').textContent = String(d.active_employees ?? '—');
    document.getElementById('dashOpenPeriods').textContent = String(d.open_periods ?? '—');
    document.getElementById('dashMtd').textContent = money(d.month_to_date_payroll_total);
    const lc = d.last_closed_period;
    document.getElementById('dashLastClosed').textContent = lc
      ? `${lc.name} (${lc.end_date}) — ${money(lc.total)}`
      : '—';
  } catch (e) {
    if (e.status === 403) showAuth('Acesso negado.');
  }
}

async function loadEmployees() {
  const j = await api('GET', '/employees?active=all');
  employees = j.data || [];
  employeesById = {};
  employees.forEach((e) => {
    employeesById[e.id] = e;
  });
  renderEmployeeTable();
  updateEmployeeEmptyState();
}

function updateEmployeeEmptyState() {
  const wrap = document.getElementById('empEmptyCta');
  if (!wrap) return;
  wrap.classList.toggle('hidden', employees.length > 0);
}

/** Totais por funcionário no quadro atual (período selecionado), incluindo linhas ainda não guardadas */
function aggregateDaysAndOtByEmployeeFromGrid() {
  const map = new Map();
  if (!selectedPeriodId) return map;
  document.querySelectorAll('#timesheetBody tr').forEach((tr) => {
    const empEl = tr.querySelector('.ts-emp');
    if (!empEl) return;
    const eid = parseInt(empEl.value, 10);
    if (!eid) return;
    const d = parseNumInput(tr.querySelector('.ts-days')?.value);
    const ot = parseNumInput(tr.querySelector('.ts-ot')?.value);
    const cur = map.get(eid) || { days: 0, ot: 0 };
    cur.days += d;
    cur.ot += ot;
    map.set(eid, cur);
  });
  return map;
}

async function loadProjects() {
  const r = await fetch('/api/projects?limit=100', { credentials: 'include' });
  const j = await r.json();
  projects = j.data || [];
}

/**
 * @param {number|null|undefined} [preferId] — após criar período, forçar esta seleção (evita string/number mismatch)
 */
async function loadPeriods(preferId) {
  const j = await api('GET', '/periods');
  periods = j.data || [];
  const sel = document.getElementById('periodSelect');
  const preferred = periodIdNum(preferId);
  const prev = periodIdNum(selectedPeriodId);
  sel.innerHTML = '<option value="">Selecione o período…</option>';
  periods.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = `${p.name} (${p.start_date} → ${p.end_date}) [${p.status}]`;
    sel.appendChild(opt);
  });
  if (preferred != null && periods.some((p) => periodIdNum(p.id) === preferred)) {
    sel.value = String(preferred);
  } else if (prev != null && periods.some((p) => periodIdNum(p.id) === prev)) {
    sel.value = String(prev);
  } else {
    sel.value = '';
  }
  selectedPeriodId = sel.value ? parseInt(sel.value, 10) : null;
  await onPeriodChange();
}

function renderEmployeeTable() {
  if (employeeAggRefreshTimer != null) {
    clearTimeout(employeeAggRefreshTimer);
    employeeAggRefreshTimer = null;
  }
  const tb = document.getElementById('employeeTbody');
  tb.innerHTML = '';
  const periodAgg = aggregateDaysAndOtByEmployeeFromGrid();
  employees.forEach((e) => {
    const agg = periodAgg.get(e.id);
    const dPer = selectedPeriodId ? fmtReportQty(agg?.days ?? 0) : '—';
    const otPer = selectedPeriodId ? fmtReportQty(agg?.ot ?? 0) : '—';
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-100';
    tr.innerHTML = `
      <td class="px-3 py-2 font-medium">${escapeHtml(e.name)}</td>
      <td class="px-3 py-2">${escapeHtml(sectorLabel(e.sector))}</td>
      <td class="px-3 py-2 text-right tabular-nums">${dPer}</td>
      <td class="px-3 py-2 text-right tabular-nums">${otPer}</td>
      <td class="px-3 py-2">${escapeHtml(e.payment_type)}</td>
      <td class="px-3 py-2 text-right">${money(e.daily_rate)}</td>
      <td class="px-3 py-2 text-right">${money(e.hourly_rate)}</td>
      <td class="px-3 py-2 text-right">${money(e.overtime_rate)}</td>
      <td class="px-3 py-2">${escapeHtml(e.payment_method || '—')}</td>
      <td class="px-3 py-2 text-right">
        ${canManage ? `<button type="button" class="text-[#1a2036] font-semibold underline text-xs emp-edit" data-id="${e.id}">Editar</button>` : '—'}
      </td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('.emp-edit').forEach((btn) => {
    btn.addEventListener('click', () => openEmployeeModal(parseInt(btn.getAttribute('data-id'), 10)));
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function employeeOptionsHtml(selectedId) {
  const active = employees.filter((e) => e.is_active);
  const sel = selectedId != null && selectedId !== '' ? String(selectedId) : '';
  const activeIds = new Set(active.map((e) => String(e.id)));
  let inactiveSelected = null;
  if (sel && !activeIds.has(sel)) {
    inactiveSelected = employeesById[sel] || employees.find((e) => String(e.id) === sel) || null;
  }
  let html =
    '<option value="">—</option>' +
    active
      .map((e) => `<option value="${e.id}"${String(e.id) === sel ? ' selected' : ''}>${escapeHtml(e.name)}</option>`)
      .join('');
  if (inactiveSelected) {
    html += `<option value="${inactiveSelected.id}" selected>${escapeHtml(inactiveSelected.name)} (inativo)</option>`;
  }
  return html;
}

function projectOptionsHtml(selectedId) {
  const sel = selectedId != null && selectedId !== '' ? String(selectedId) : '';
  return (
    '<option value="">—</option>' +
    projects
      .map(
        (p) =>
          `<option value="${p.id}"${String(p.id) === sel ? ' selected' : ''}>${escapeHtml(p.project_number || '#' + p.id)}</option>`
      )
      .join('')
  );
}

/** <input type="date"> só aceita AAAA-MM-DD; ISO com hora ou timezone pode mostrar o dia errado */
function formatWorkDateForInput(v) {
  if (v == null || v === '') return '';
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** DECIMAL da API (string "1.00", etc.) → texto estável para <input type="number"> */
function formatQtyForInput(v) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  const r = Math.round(n * 100) / 100;
  if (r === 0) return '';
  if (Number.isInteger(r)) return String(r);
  return String(r);
}

function localTodayISO() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localDateToYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultWorkDate() {
  const p = selectedPeriodRecord();
  if (!p || p.start_date == null || p.end_date == null) return localTodayISO();
  const s = String(p.start_date).slice(0, 10);
  const e = String(p.end_date).slice(0, 10);
  const t = localTodayISO();
  if (t >= s && t <= e) return t;
  return s;
}

/** Data AAAA-MM-DD dentro do período selecionado (validação antes do POST). */
function workDateInsideSelectedPeriod(ymd) {
  const p = selectedPeriodRecord();
  if (!p || !ymd || ymd.length < 10) return false;
  const s = String(p.start_date || '').slice(0, 10);
  const e = String(p.end_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return true;
  return ymd >= s && ymd <= e;
}

function bumpInput(tr, sel, delta, min = 0) {
  const input = tr.querySelector(sel);
  if (!input || input.disabled) return;
  const cur = Number(String(input.value).replace(',', '.')) || 0;
  const n = Math.max(min, Math.round((cur + delta) * 100) / 100);
  input.value = n === 0 ? '' : String(n);
  refreshRowAmount(tr);
}

function parseNumInput(v) {
  if (v === '' || v == null) return 0;
  return Number(String(v).replace(',', '.')) || 0;
}

function refreshRowAmount(tr) {
  const empId = parseInt(tr.querySelector('.ts-emp').value, 10);
  const row = {
    days_worked: parseNumInput(tr.querySelector('.ts-days').value),
    regular_hours: parseNumInput(tr.querySelector('.ts-reg').value),
    overtime_hours: parseNumInput(tr.querySelector('.ts-ot').value),
  };
  const drInp = tr.querySelector('.ts-daily-override');
  if (drInp) {
    const t = (drInp.value || '').trim();
    if (t !== '') row.daily_rate_override = parseNumInput(t);
  }
  const amt = calcLinePreview(empId, row);
  tr.querySelector('.ts-amt').textContent = money(amt);
  updatePeriodRunningTotalFromDom();
}

function syncDailyOverrideHint(tr) {
  const empId = parseInt(tr.querySelector('.ts-emp')?.value, 10);
  const inp = tr.querySelector('.ts-daily-override');
  if (!inp) return;
  const emp = employeesById[empId];
  if (!emp) {
    inp.placeholder = '';
    return;
  }
  const hourly = String(emp.payment_type || '').toLowerCase() === 'hourly';
  inp.placeholder = hourly ? '—' : String(emp.daily_rate ?? '');
  inp.title = hourly
    ? 'Tipo por hora: o valor usa só horas (e HE); este campo não altera o cálculo.'
    : 'Opcional: diária só neste dia. Vazio = usa a diária do cadastro do funcionário.';
}

function tsTap(ev, fn) {
  ev.preventDefault();
  ev.stopPropagation();
  fn();
}

function bindRowEvents(tr) {
  tr.querySelectorAll('.ts-date, .ts-emp, .ts-days, .ts-reg, .ts-ot, .ts-daily-override').forEach((el) => {
    el.addEventListener('change', () => refreshRowAmount(tr));
    el.addEventListener('input', () => refreshRowAmount(tr));
  });
  tr.querySelector('.ts-emp')?.addEventListener('change', () => syncDailyOverrideHint(tr));
  tr.querySelector('.ts-days-dec')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-days', -0.25)));
  tr.querySelector('.ts-days-inc')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-days', 0.25)));
  tr.querySelector('.ts-reg-dec')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-reg', -0.25)));
  tr.querySelector('.ts-reg-inc')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-reg', 0.25)));
  tr.querySelector('.ts-reg-2')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-reg', 2)));
  tr.querySelector('.ts-reg-4')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-reg', 4)));
  tr.querySelector('.ts-ot-dec')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', -0.25)));
  tr.querySelector('.ts-ot-inc')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', 0.25)));
  tr.querySelector('.ts-ot-1')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', 1)));
  tr.querySelector('.ts-ot-2')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', 2)));
  tr.querySelector('.ts-ot-4')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', 4)));
  tr.querySelector('.ts-full')?.addEventListener('click', (e) =>
    tsTap(e, () => {
      const inp = tr.querySelector('.ts-days');
      if (!inp || inp.disabled) return;
      inp.value = '1';
      refreshRowAmount(tr);
    })
  );
  tr.querySelector('.ts-half')?.addEventListener('click', (e) =>
    tsTap(e, () => {
      const inp = tr.querySelector('.ts-days');
      if (!inp || inp.disabled) return;
      inp.value = '0.5';
      refreshRowAmount(tr);
    })
  );
  tr.querySelector('.ts-del')?.addEventListener('click', async () => {
    const id = tr.dataset.lineId;
    if (!id) {
      tr.remove();
      updatePeriodRunningTotalFromDom();
      return;
    }
    if (!canEditTimesheetGrid()) return;
    if (!window.confirm('Apagar esta linha do quadro de horas?')) return;
    try {
      await api('DELETE', `/timesheets/${id}`);
      window.crmToast?.success?.('Linha removida');
      await loadTimesheetsForPeriod();
    } catch (err) {
      window.crmToast?.error?.(err.message);
    }
  });
}

function appendTimesheetRow(data) {
  const tb = document.getElementById('timesheetBody');
  const tr = document.createElement('tr');
  tr.className = 'border-t border-slate-100';
  const id = data?.id;
  if (id) tr.dataset.lineId = String(id);
  const grid = canEditTimesheetGrid();
  const dis = grid ? '' : ' disabled';
  const d0 = formatQtyForInput(data?.days_worked);
  const r0 = formatQtyForInput(data?.regular_hours);
  const o0 = formatQtyForInput(data?.overtime_hours);
  const drOv =
    data?.daily_rate_override != null && data?.daily_rate_override !== ''
      ? formatQtyForInput(data.daily_rate_override) || String(data.daily_rate_override)
      : '';
  const wDate = formatWorkDateForInput(data?.work_date);
  tr.innerHTML = `
    <td class="px-2 py-1 align-top"><input type="date" class="ts-date w-full border rounded px-2 py-2 text-sm"${dis} value="${wDate}" /></td>
    <td class="px-2 py-1 align-top"><select class="ts-emp w-full border rounded px-2 py-2 text-sm"${dis}>${employeeOptionsHtml(data?.employee_id)}</select></td>
    <td class="px-2 py-1 align-top"><select class="ts-proj w-full border rounded px-2 py-2 text-sm"${dis}>${projectOptionsHtml(data?.project_id)}</select></td>
    <td class="px-1 py-1 align-top"><input type="number" inputmode="decimal" step="any" min="0" class="ts-daily-override payroll-num-input w-[4.5rem] border rounded px-1 py-2 text-sm"${dis} value="${drOv}" /></td>
    <td class="px-1 py-1 align-top">
      <div class="flex items-center justify-center gap-0.5">
        <button type="button" class="ts-numbtn ts-days-dec"${dis} aria-label="Menos dia">−</button>
        <input type="number" inputmode="decimal" step="any" min="0" class="ts-days payroll-num-input w-[4.25rem] border rounded"${dis} value="${d0 === '' || d0 == null ? '' : d0}" />
        <button type="button" class="ts-numbtn ts-days-inc"${dis} aria-label="Mais dia">+</button>
      </div>
      <div class="flex justify-center gap-1 mt-1">
        <button type="button" class="ts-short ts-full text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>1d</button>
        <button type="button" class="ts-short ts-half text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>½</button>
      </div>
    </td>
    <td class="px-1 py-1 align-top">
      <div class="flex items-center justify-center gap-0.5">
        <button type="button" class="ts-numbtn ts-reg-dec"${dis} aria-label="Menos horas">−</button>
        <input type="number" inputmode="decimal" step="any" min="0" class="ts-reg payroll-num-input w-[4.25rem] border rounded"${dis} value="${r0 === '' || r0 == null ? '' : r0}" />
        <button type="button" class="ts-numbtn ts-reg-inc"${dis} aria-label="Mais horas">+</button>
      </div>
      <div class="flex justify-center gap-1 mt-1 flex-wrap">
        <button type="button" class="ts-short ts-reg-2 text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+2h</button>
        <button type="button" class="ts-short ts-reg-4 text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+4h</button>
      </div>
    </td>
    <td class="px-1 py-1 align-top">
      <div class="flex items-center justify-center gap-0.5">
        <button type="button" class="ts-numbtn ts-ot-dec"${dis} aria-label="Menos HE">−</button>
        <input type="number" inputmode="decimal" step="any" min="0" class="ts-ot payroll-num-input w-[4.25rem] border rounded"${dis} value="${o0 === '' || o0 == null ? '' : o0}" />
        <button type="button" class="ts-numbtn ts-ot-inc"${dis} aria-label="Mais HE">+</button>
      </div>
      <div class="flex justify-center gap-1 mt-1 flex-wrap">
        <button type="button" class="ts-short ts-ot-1 text-[10px] px-2 py-1 border border-amber-200 bg-amber-50 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+1h</button>
        <button type="button" class="ts-short ts-ot-2 text-[10px] px-2 py-1 border border-amber-200 bg-amber-50 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+2h</button>
        <button type="button" class="ts-short ts-ot-4 text-[10px] px-2 py-1 border border-amber-200 bg-amber-50 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+4h</button>
      </div>
    </td>
    <td class="px-2 py-1 align-top"><input type="text" class="ts-notes w-full border rounded px-2 py-2 text-sm"${dis} value="" /></td>
    <td class="px-2 py-1 text-right ts-amt text-sm font-semibold align-middle">${money(data?.calculated_amount ?? 0)}</td>
    <td class="px-2 py-1 align-middle">
      <button type="button" class="ts-del px-2 py-1 text-sm border border-red-200 text-red-700 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''} title="Apagar linha">×</button>
    </td>`;
  tb.appendChild(tr);
  if (data?.notes) tr.querySelector('.ts-notes').value = data.notes;
  bindRowEvents(tr);
  syncDailyOverrideHint(tr);
  refreshRowAmount(tr);
}

function updatePeriodRunningTotalFromDom() {
  let sum = 0;
  document.querySelectorAll('#timesheetBody tr').forEach((tr) => {
    const empId = parseInt(tr.querySelector('.ts-emp').value, 10);
    const row = {
      days_worked: parseNumInput(tr.querySelector('.ts-days').value),
      regular_hours: parseNumInput(tr.querySelector('.ts-reg').value),
      overtime_hours: parseNumInput(tr.querySelector('.ts-ot').value),
    };
    const drT = tr.querySelector('.ts-daily-override');
    if (drT) {
      const t = (drT.value || '').trim();
      if (t !== '') row.daily_rate_override = parseNumInput(t);
    }
    sum += calcLinePreview(empId, row);
  });
  document.getElementById('periodRunningTotal').textContent = money(sum);
  if (employeeAggRefreshTimer != null) clearTimeout(employeeAggRefreshTimer);
  employeeAggRefreshTimer = setTimeout(() => {
    employeeAggRefreshTimer = null;
    renderEmployeeTable();
  }, 120);
}

function applyPeriodMetaBanner(p) {
  const freqPt =
    p?.frequency === 'weekly'
      ? 'Semanal'
      : p?.frequency === 'biweekly'
        ? 'Quinzenal'
        : p?.frequency === 'monthly'
          ? 'Mensal'
          : p?.frequency || '';
  document.getElementById('periodMeta').textContent = p
    ? `${freqPt} · ${p.start_date} → ${p.end_date} · ${p.status === 'closed' ? 'Fechado' : 'Aberto'}`
    : '';
  const badge = document.getElementById('periodLockBadge');
  if (p?.status === 'closed') badge.classList.remove('hidden');
  else badge.classList.add('hidden');
}

async function loadTimesheetsForPeriod() {
  document.getElementById('timesheetBody').innerHTML = '';
  if (!selectedPeriodId) {
    currentPeriod = null;
    document.getElementById('periodMeta').textContent = '';
    document.getElementById('periodLockBadge').classList.add('hidden');
    document.getElementById('periodRunningTotal').textContent = money(0);
    renderEmployeeTable();
    refreshPeriodActions();
    return;
  }
  try {
    const j = await api('GET', `/periods/${selectedPeriodId}/timesheets`);
    currentPeriod = j.period;
    timesheetRows = j.data || [];
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro ao carregar o quadro.');
    timesheetRows = [];
    const fromList = periods.find((x) => periodIdNum(x.id) === periodIdNum(selectedPeriodId));
    currentPeriod = fromList || { id: selectedPeriodId, status: 'open', start_date: null, end_date: null };
  }

  const p = selectedPeriodRecord();
  applyPeriodMetaBanner(p);

  timesheetRows.forEach((row) => appendTimesheetRow(row));
  updatePeriodRunningTotalFromDom();
  renderEmployeeTable();
  refreshPeriodActions();
}

async function onPeriodChange() {
  const sel = document.getElementById('periodSelect');
  selectedPeriodId = sel.value ? parseInt(sel.value, 10) : null;
  await loadTimesheetsForPeriod();
}

function collectLinesFromGrid() {
  const lines = [];
  document.querySelectorAll('#timesheetBody tr').forEach((tr) => {
    const dateEl = tr.querySelector('.ts-date');
    const empEl = tr.querySelector('.ts-emp');
    const projEl = tr.querySelector('.ts-proj');
    const daysEl = tr.querySelector('.ts-days');
    const regEl = tr.querySelector('.ts-reg');
    const otEl = tr.querySelector('.ts-ot');
    const notesEl = tr.querySelector('.ts-notes');
    if (!dateEl || !empEl || !daysEl || !regEl || !otEl || !notesEl) return;

    const work_date = formatWorkDateForInput(dateEl.value);
    const employee_id = empEl.value;
    const projectSel = projEl ? projEl.value : '';
    const days_worked = daysEl.value;
    const regular_hours = regEl.value;
    const overtime_hours = otEl.value;
    const notes = (notesEl.value || '').trim();
    const drRaw = (tr.querySelector('.ts-daily-override')?.value || '').trim();

    const lidRaw = tr.dataset.lineId;
    const lidNum = lidRaw != null && String(lidRaw).trim() !== '' ? parseInt(String(lidRaw), 10) : NaN;
    const hasPersistedId = Number.isFinite(lidNum) && lidNum > 0;

    if (!employee_id || !work_date) return;
    const d = parseNumInput(days_worked);
    const r = parseNumInput(regular_hours);
    const ot = parseNumInput(overtime_hours);
    /* Não gravar linha nova totalmente vazia (evita lixo na BD) */
    if (!hasPersistedId && d === 0 && r === 0 && ot === 0 && !notes) return;
    const o = {
      employee_id: parseInt(employee_id, 10),
      project_id: projectSel ? parseInt(projectSel, 10) : null,
      work_date,
      days_worked: d,
      regular_hours: r,
      overtime_hours: ot,
      notes: notes || null,
      daily_rate_override: drRaw !== '' ? parseNumInput(drRaw) : null,
    };
    if (hasPersistedId) o.id = lidNum;
    lines.push(o);
  });
  return lines;
}

/** Linhas com algum valor mas sem data ou funcionário — avisar antes de guardar */
function timesheetGridValidationIssues() {
  const issues = [];
  let idx = 0;
  const seenKeys = new Map();
  document.querySelectorAll('#timesheetBody tr').forEach((tr) => {
    idx += 1;
    const work_date = formatWorkDateForInput(tr.querySelector('.ts-date')?.value);
    const employee_id = tr.querySelector('.ts-emp')?.value;
    const d = parseNumInput(tr.querySelector('.ts-days')?.value);
    const r = parseNumInput(tr.querySelector('.ts-reg')?.value);
    const ot = parseNumInput(tr.querySelector('.ts-ot')?.value);
    const notes = (tr.querySelector('.ts-notes')?.value || '').trim();
    const proj = (tr.querySelector('.ts-proj')?.value || '').trim();
    const lidRaw = tr.dataset.lineId;
    const lidNum = lidRaw != null && String(lidRaw).trim() !== '' ? parseInt(String(lidRaw), 10) : NaN;
    const hasPersistedId = Number.isFinite(lidNum) && lidNum > 0;

    const touched =
      !!employee_id ||
      !!work_date ||
      d > 0 ||
      r > 0 ||
      ot > 0 ||
      !!notes ||
      !!(tr.querySelector('.ts-daily-override')?.value || '').trim();
    if (!touched) return;

    if (!employee_id) issues.push(`Linha ${idx}: escolha o funcionário.`);
    if (!work_date) issues.push(`Linha ${idx}: escolha a data do trabalho.`);
    if (work_date && !workDateInsideSelectedPeriod(work_date)) {
      issues.push(
        `Linha ${idx}: a data ${work_date} está fora do período (${String(selectedPeriodRecord()?.start_date || '').slice(0, 10)} → ${String(selectedPeriodRecord()?.end_date || '').slice(0, 10)}).`
      );
    }
    if (!hasPersistedId && d === 0 && r === 0 && ot === 0 && !notes) {
      issues.push(
        `Linha ${idx}: para uma linha nova, preencha diárias (botões 1d/½ ou ±), horas normais/extra ou uma nota.`
      );
    }
    if (employee_id && work_date && Number.isFinite(parseInt(employee_id, 10))) {
      const dupKey = `${parseInt(employee_id, 10)}|${work_date}|${proj || '0'}`;
      if (!hasPersistedId && seenKeys.has(dupKey)) {
        issues.push(
          `Linha ${idx}: duplicado (mesmo funcionário, data e projeto) — o servidor só aceita uma linha. Junte numa só ou altere projeto/data.`
        );
      }
      if (!hasPersistedId) seenKeys.set(dupKey, idx);
    }
  });
  return issues;
}

function openEmployeeModal(editId) {
  const m = document.getElementById('empModal');
  document.getElementById('empFormErr').classList.add('hidden');
  document.getElementById('empEditId').value = editId || '';
  document.getElementById('empModalTitle').textContent = editId ? 'Editar funcionário' : 'Novo funcionário';
  document.getElementById('empActiveWrap').classList.toggle('hidden', !editId);
  if (editId) {
    const e = employeesById[editId];
    if (!e) return;
    document.getElementById('empName').value = e.name || '';
    document.getElementById('empRole').value = e.role || '';
    document.getElementById('empPhone').value = e.phone || '';
    document.getElementById('empEmail').value = e.email || '';
    document.getElementById('empPayType').value = e.payment_type || 'daily';
    document.getElementById('empDaily').value = e.daily_rate ?? '';
    document.getElementById('empHourly').value = e.hourly_rate ?? '';
    document.getElementById('empOt').value = e.overtime_rate ?? '';
    document.getElementById('empPayMethod').value = e.payment_method || '';
    const secEl = document.getElementById('empSector');
    if (secEl) secEl.value = e.sector || '';
    document.getElementById('empActive').checked = !!e.is_active;
  } else {
    ['empName', 'empRole', 'empPhone', 'empEmail', 'empPayMethod'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    document.getElementById('empPayType').value = 'daily';
    document.getElementById('empDaily').value = '0';
    document.getElementById('empHourly').value = '0';
    document.getElementById('empOt').value = '0';
    const secElNew = document.getElementById('empSector');
    if (secElNew) secElNew.value = '';
  }
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closeEmployeeModal() {
  const m = document.getElementById('empModal');
  m.classList.add('hidden');
  m.classList.remove('flex');
}

async function saveEmployee() {
  const err = document.getElementById('empFormErr');
  err.classList.add('hidden');
  const editId = document.getElementById('empEditId').value;
  const body = {
    name: document.getElementById('empName').value.trim(),
    role: document.getElementById('empRole').value.trim() || null,
    phone: document.getElementById('empPhone').value.trim() || null,
    email: document.getElementById('empEmail').value.trim() || null,
    payment_type: document.getElementById('empPayType').value,
    daily_rate: Number(document.getElementById('empDaily').value) || 0,
    hourly_rate: Number(document.getElementById('empHourly').value) || 0,
    overtime_rate: Number(document.getElementById('empOt').value) || 0,
    payment_method: document.getElementById('empPayMethod').value.trim() || null,
    sector: document.getElementById('empSector')?.value || null,
  };
  if (editId) {
    body.is_active = document.getElementById('empActive').checked;
  }
  if (!body.name) {
    err.textContent = 'O nome é obrigatório.';
    err.classList.remove('hidden');
    return;
  }
  try {
    if (editId) {
      await api('PUT', `/employees/${editId}`, body);
      window.crmToast?.success?.('Funcionário atualizado');
    } else {
      await api('POST', '/employees', body);
      window.crmToast?.success?.('Funcionário criado');
    }
    closeEmployeeModal();
    await loadEmployees();
    await loadTimesheetsForPeriod();
  } catch (e) {
    let msg = e.message || 'Erro ao guardar.';
    if (e.status === 403) {
      msg =
        'Sem permissão para criar/editar funcionários (payroll.manage). Atualize a página; se continuar, peça ao administrador para lhe conceder payroll.manage na matriz de permissões.';
    }
    if (e.status === 503 && e.payload?.code === 'PAYROLL_SCHEMA_MISSING') {
      msg = 'Tabelas de folha não instaladas no servidor. Execute as migrações MySQL (construction-payroll + payroll-sector-reimbursement).';
    }
    err.textContent = msg;
    err.classList.remove('hidden');
    window.crmToast?.error?.(msg);
  }
}

function openPeriodModal() {
  const m = document.getElementById('periodModal');
  document.getElementById('perFormErr').classList.add('hidden');
  document.getElementById('perName').value = '';
  document.getElementById('perFreq').value = 'biweekly';
  const t = new Date();
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 13);
  document.getElementById('perStart').value = start.toISOString().slice(0, 10);
  document.getElementById('perEnd').value = t.toISOString().slice(0, 10);
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closePeriodModal() {
  const m = document.getElementById('periodModal');
  m.classList.add('hidden');
  m.classList.remove('flex');
}

async function savePeriod() {
  const err = document.getElementById('perFormErr');
  err.classList.add('hidden');
  const body = {
    name: document.getElementById('perName').value.trim(),
    frequency: document.getElementById('perFreq').value,
    start_date: document.getElementById('perStart').value,
    end_date: document.getElementById('perEnd').value,
  };
  if (!body.name) {
    err.textContent = 'O nome do período é obrigatório.';
    err.classList.remove('hidden');
    return;
  }
  try {
    const j = await api('POST', '/periods', body);
    closePeriodModal();
    const newId = periodIdNum(j.data?.id);
    window.crmToast?.success?.('Período criado');
    await loadPeriods(newId);
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

function bindPreviewAdjustmentsLiveTotals(fixedGrandSheet) {
  previewAdjustmentsLiveAbort?.abort();
  previewAdjustmentsLiveAbort = new AbortController();
  const { signal } = previewAdjustmentsLiveAbort;

  const recalc = () => {
    const gSheet = Number(fixedGrandSheet) || 0;
    let sumReim = 0;
    let sumDisc = 0;
    document.querySelectorAll('#previewTbody tr').forEach((tr) => {
      const sub = Number(tr.dataset.subtotal) || 0;
      const reimInp = tr.querySelector('.preview-reim-input');
      const discInp = tr.querySelector('.preview-disc-input');
      const reim = reimInp ? Math.max(0, Number(reimInp.value) || 0) : 0;
      const disc = discInp ? Math.max(0, Number(discInp.value) || 0) : 0;
      sumReim += reim;
      sumDisc += disc;
      const totCell = tr.querySelector('.preview-emp-total');
      if (totCell) {
        totCell.textContent = money(Math.round((sub + reim - disc) * 100) / 100);
      }
    });
    const gEl = document.getElementById('previewGrandSheet');
    const rEl = document.getElementById('previewGrandReim');
    const dEl = document.getElementById('previewGrandDisc');
    const tEl = document.getElementById('previewGrandTotal');
    if (gEl) gEl.textContent = money(gSheet);
    if (rEl) rEl.textContent = money(Math.round(sumReim * 100) / 100);
    if (dEl) dEl.textContent = money(Math.round(sumDisc * 100) / 100);
    if (tEl) tEl.textContent = money(Math.round((gSheet + sumReim - sumDisc) * 100) / 100);
  };

  const tbody = document.getElementById('previewTbody');
  tbody?.addEventListener(
    'input',
    (ev) => {
      const t = ev.target;
      if (t?.classList?.contains('preview-reim-input') || t?.classList?.contains('preview-disc-input')) {
        recalc();
      }
    },
    { signal }
  );
  recalc();
}

function fillPreviewModal(data, opts) {
  closingPeriodMode = !!(opts && opts.closing);
  previewAdjustmentsLiveAbort?.abort();
  previewAdjustmentsLiveAbort = null;

  const tbody = document.getElementById('previewTbody');
  tbody.innerHTML = '';
  const periodClosed = data.period?.status === 'closed';
  const editReim = closingPeriodMode && canManage && !periodClosed;

  document.getElementById('previewReimHint')?.classList.toggle('hidden', !editReim);

  (data.by_employee || []).forEach((row) => {
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-100';
    tr.dataset.employeeId = String(row.employee_id);
    tr.dataset.subtotal = String(Number(row.subtotal) || 0);
    const reimVal = Number(row.reimbursement) || 0;
    const discVal = Number(row.discount) || 0;
    const reimCell = editReim
      ? `<td class="px-2 py-2"><input type="number" step="0.01" min="0" class="preview-reim-input w-full border rounded-lg px-2 py-2 text-sm" value="${reimVal}" /></td>`
      : `<td class="px-3 py-2 text-right">${money(reimVal)}</td>`;
    const discCell = editReim
      ? `<td class="px-2 py-2"><input type="number" step="0.01" min="0" class="preview-disc-input w-full border rounded-lg px-2 py-2 text-sm" value="${discVal}" /></td>`
      : `<td class="px-3 py-2 text-right">${money(discVal)}</td>`;
    const empTot = row.employee_total != null ? row.employee_total : Number(row.subtotal) + reimVal - discVal;
    tr.innerHTML = `<td class="px-3 py-2 font-medium">${escapeHtml(row.name)}</td>
      <td class="px-3 py-2 text-slate-600">${escapeHtml(sectorLabel(row.sector))}</td>
      <td class="px-3 py-2 text-right">${row.line_count}</td>
      <td class="px-3 py-2 text-right">${money(row.subtotal)}</td>
      ${reimCell}
      ${discCell}
      <td class="px-3 py-2 text-right font-semibold preview-emp-total">${money(empTot)}</td>`;
    tbody.appendChild(tr);
  });

  const sumSheet = (data.by_employee || []).reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
  const sumReim = (data.by_employee || []).reduce((s, r) => s + (Number(r.reimbursement) || 0), 0);
  const sumDisc = (data.by_employee || []).reduce((s, r) => s + (Number(r.discount) || 0), 0);
  const gSheet = data.grand_timesheet != null ? Number(data.grand_timesheet) : sumSheet;
  const gReim = data.grand_reimbursement != null ? Number(data.grand_reimbursement) : sumReim;
  const gDisc = data.grand_discount != null ? Number(data.grand_discount) : sumDisc;
  const gTot =
    data.grand_total != null ? Number(data.grand_total) : Math.round((gSheet + gReim - gDisc) * 100) / 100;

  document.getElementById('previewGrandSheet').textContent = money(gSheet);
  document.getElementById('previewGrandReim').textContent = money(gReim);
  document.getElementById('previewGrandDisc').textContent = money(gDisc);
  document.getElementById('previewGrandTotal').textContent = money(gTot);

  document.getElementById('previewTitle').textContent = closingPeriodMode
    ? 'Fechamento — reembolsos e descontos'
    : 'Pré-visualização da folha';
  document.getElementById('previewSubtitle').textContent = data.period
    ? `${data.period.name} (${data.period.start_date} → ${data.period.end_date})`
    : '';
  document.getElementById('previewCloseActions').classList.toggle('hidden', !closingPeriodMode);
  document.getElementById('previewCloseOnly').classList.toggle('hidden', closingPeriodMode);

  if (editReim) {
    bindPreviewAdjustmentsLiveTotals(gSheet);
  }
}

function collectAdjustmentsFromPreview() {
  const rows = [];
  document.querySelectorAll('#previewTbody tr').forEach((tr) => {
    const id = parseInt(tr.dataset.employeeId, 10);
    if (!id) return;
    const reimInp = tr.querySelector('.preview-reim-input');
    const discInp = tr.querySelector('.preview-disc-input');
    const reimbursement = reimInp ? Number(reimInp.value) || 0 : 0;
    const discount = discInp ? Number(discInp.value) || 0 : 0;
    rows.push({ employee_id: id, reimbursement, discount });
  });
  return rows;
}

async function saveAdjustmentsFromPreview() {
  if (!selectedPeriodId || !canManage) return;
  const adjustments = collectAdjustmentsFromPreview();
  await api('PUT', `/periods/${selectedPeriodId}/adjustments`, { adjustments });
}

function openPreviewModal() {
  const m = document.getElementById('previewModal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closePreviewModal() {
  previewAdjustmentsLiveAbort?.abort();
  previewAdjustmentsLiveAbort = null;
  const m = document.getElementById('previewModal');
  m.classList.add('hidden');
  m.classList.remove('flex');
  closingPeriodMode = false;
}

async function fetchAndShowPreview(closing) {
  if (!selectedPeriodId) {
    window.crmToast?.error?.('Selecione um período.');
    return;
  }
  try {
    const j = await api('GET', `/periods/${selectedPeriodId}/preview`);
    fillPreviewModal(j.data || {}, { closing });
    openPreviewModal();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
}

async function confirmClosePeriod() {
  if (!selectedPeriodId) return;
  try {
    await saveAdjustmentsFromPreview();
    await api('POST', `/periods/${selectedPeriodId}/close`);
    window.crmToast?.success?.('Período fechado e bloqueado.');
    closePreviewModal();
    await loadPeriods();
    await loadDashboard();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
}

function initReportDates() {
  const t = new Date();
  const from = new Date(t.getFullYear(), t.getMonth(), 1);
  const rf = document.getElementById('reportFrom');
  const rt = document.getElementById('reportTo');
  if (rf) rf.value = localDateToYMD(from);
  if (rt) rt.value = localDateToYMD(t);
}

/** Intervalo De/Até para relatórios (datas locais; corrige se De > Até). */
function getReportRangeOrToast() {
  const rf = document.getElementById('reportFrom');
  const rt = document.getElementById('reportTo');
  if (!rf || !rt) return null;
  let from = (rf.value || '').trim();
  let to = (rt.value || '').trim();
  if (!from || !to) {
    window.crmToast?.error?.('Defina as datas De / Até.');
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    window.crmToast?.error?.('Datas inválidas — use o seletor de data do navegador.');
    return null;
  }
  if (from > to) {
    const x = from;
    from = to;
    to = x;
  }
  return { from, to };
}

function buildReportTableFragment(title, headers, rows) {
  let html = `<div class="rounded-xl border border-slate-200 overflow-hidden shadow-sm"><h3 class="font-bold text-slate-900 px-4 py-3 bg-slate-50 border-b text-sm">${escapeHtml(title)}</h3><div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr>`;
  headers.forEach((h) => {
    html += `<th class="px-3 py-2 text-left text-xs uppercase text-slate-500 bg-white border-b border-slate-100">${escapeHtml(h)}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach((cells) => {
    html += '<tr class="border-t border-slate-100">';
    cells.forEach((c) => {
      html += `<td class="px-3 py-2">${c}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

function buildTotalReportFragment(d, from, to) {
  const sheet = d.timesheet_total != null ? d.timesheet_total : d.total;
  const reim = d.reimbursement_total != null ? d.reimbursement_total : 0;
  const disc = d.discount_total != null ? d.discount_total : 0;
  const tot =
    d.total != null ? d.total : Math.round((Number(sheet || 0) + Number(reim || 0) - Number(disc || 0)) * 100) / 100;
  return `<div class="rounded-xl border-2 border-[#1a2036]/20 bg-[#1a2036] text-white overflow-hidden shadow-sm">
    <h3 class="font-bold px-4 py-3 text-[#d6b598] text-xs uppercase tracking-wide">Resumo financeiro</h3>
    <div class="px-4 pb-4">
      <p class="text-2xl font-bold">${money(tot)}</p>
      <p class="text-sm text-slate-300 mt-1">Folha: ${money(sheet)} · Reemb.: ${money(reim)} · Desc.: ${money(disc)}</p>
      <p class="text-xs text-slate-400 mt-2">${d.line_count != null ? d.line_count : 0} linhas no quadro · ${escapeHtml(from)} → ${escapeHtml(to)}</p>
    </div>
  </div>`;
}

function renderReportTable(title, headers, rows) {
  document.getElementById('reportOut').innerHTML = buildReportTableFragment(title, headers, rows);
}

async function runReportEmployees() {
  const range = getReportRangeOrToast();
  if (!range) return;
  const { from, to } = range;
  const j = await api('GET', `/reports/employee-earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const raw = j.data || [];
  if (!raw.length) {
    document.getElementById('reportOut').innerHTML =
      '<p class="text-sm text-slate-600 py-4">Nenhum lançamento no quadro neste intervalo (<strong>' +
      escapeHtml(from) +
      '</strong> → <strong>' +
      escapeHtml(to) +
      '</strong>).</p>';
    return;
  }
  const rows = mapEmployeeReportRows(raw);
  renderReportTable('Ganhos por funcionário', ['Nome', 'Setor', 'Função', 'Linhas', 'Folha', 'Reemb.', 'Desc.', 'Total'], rows);
}

async function runReportProjects() {
  const range = getReportRangeOrToast();
  if (!range) return;
  const { from, to } = range;
  const j = await api('GET', `/reports/project-labor?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const raw = j.data || [];
  if (!raw.length) {
    document.getElementById('reportOut').innerHTML =
      '<p class="text-sm text-slate-600 py-4">Nenhum custo por projeto neste intervalo.</p>';
    return;
  }
  const rows = mapProjectReportRows(raw);
  renderReportTable('Mão de obra por projeto', ['Projeto', 'Número', 'Linhas', 'Custo'], rows);
}

async function runReportTotal() {
  const range = getReportRangeOrToast();
  if (!range) return;
  const { from, to } = range;
  const j = await api('GET', `/reports/total-expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  document.getElementById('reportOut').innerHTML = buildTotalReportFragment(j.data || {}, from, to);
}

function mapEmployeeReportRows(raw) {
  return (raw || []).map((r) => [
    escapeHtml(r.name ?? '—'),
    escapeHtml(sectorLabel(r.sector)),
    fmtReportQty(r.total_days),
    fmtReportQty(r.total_overtime_hours),
    money(r.timesheet_earnings != null ? r.timesheet_earnings : 0),
    money(r.reimbursement_total != null ? r.reimbursement_total : 0),
    money(r.discount_total != null ? r.discount_total : 0),
    money(r.total_earnings != null ? r.total_earnings : 0),
  ]);
}

function mapProjectReportRows(raw) {
  return (raw || []).map((r) => [
    r.project_id != null && r.project_id !== '' ? `#${r.project_id}` : '—',
    escapeHtml(r.project_number || '—'),
    String(r.entries ?? 0),
    money(r.labor_cost),
  ]);
}

async function runReportAll() {
  const range = getReportRangeOrToast();
  if (!range) return;
  const { from, to } = range;
  const q = (path) =>
    api('GET', `${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const out = document.getElementById('reportOut');
  if (!out) return;
  try {
    const [sEmp, sProj, sTot] = await Promise.allSettled([
      q('/reports/employee-earnings'),
      q('/reports/project-labor'),
      q('/reports/total-expenses'),
    ]);
    const errMsgs = [];
    if (sTot.status === 'rejected') errMsgs.push(sTot.reason?.message || 'Totais');
    if (sEmp.status === 'rejected') errMsgs.push(sEmp.reason?.message || 'Por funcionário');
    if (sProj.status === 'rejected') errMsgs.push(sProj.reason?.message || 'Por projeto');
    if (errMsgs.length === 3) {
      window.crmToast?.error?.(`Relatório falhou: ${errMsgs[0]}`);
      return;
    }

    const jEmp = sEmp.status === 'fulfilled' ? sEmp.value : { data: [] };
    const jProj = sProj.status === 'fulfilled' ? sProj.value : { data: [] };

    const empRows = mapEmployeeReportRows(jEmp.data);
    const projRows = mapProjectReportRows(jProj.data);

    const summaryBlock =
      sTot.status === 'fulfilled'
        ? buildTotalReportFragment((sTot.value && sTot.value.data) || {}, from, to)
        : `<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Resumo financeiro indisponível: ${escapeHtml(
            String(sTot.reason?.message || 'erro no servidor')
          )}</div>`;

    let warn = '';
    if (errMsgs.length && errMsgs.length < 3) {
      warn = `<p class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">Aviso: ${escapeHtml(errMsgs.join(' · '))}</p>`;
    }

    out.innerHTML = `
      ${warn}
      <p class="text-sm text-slate-600 font-medium">Intervalo: <strong>${escapeHtml(from)}</strong> → <strong>${escapeHtml(to)}</strong></p>
      <div class="space-y-4 mt-3">
        ${summaryBlock}
        ${buildReportTableFragment('Por funcionário', EMPLOYEE_REPORT_HEADERS, empRows)}
        ${buildReportTableFragment('Por projeto', ['ID', 'Número', 'Linhas', 'Custo'], projRows)}
      </div>`;
    window.crmToast?.success?.(errMsgs.length ? 'Relatório parcial gerado' : 'Relatório completo gerado');
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro ao gerar relatório');
  }
}

async function quickSaveEmployee() {
  const errEl = document.getElementById('empQuickErr');
  errEl?.classList.add('hidden');
  const name = document.getElementById('empQuickName')?.value.trim();
  if (!name) {
    if (errEl) {
      errEl.textContent = 'Indique o nome do funcionário.';
      errEl.classList.remove('hidden');
    }
    return;
  }
  const body = {
    name,
    sector: document.getElementById('empQuickSector')?.value || null,
    payment_type: 'daily',
    daily_rate: Number(document.getElementById('empQuickDaily')?.value) || 0,
    hourly_rate: 0,
    overtime_rate: 0,
    role: null,
    phone: null,
    email: null,
    payment_method: null,
  };
  try {
    await api('POST', '/employees', body);
    const qn = document.getElementById('empQuickName');
    const qd = document.getElementById('empQuickDaily');
    if (qn) qn.value = '';
    if (qd) qd.value = '';
    window.crmToast?.success?.('Funcionário adicionado — já pode lançar horas.');
    await loadEmployees();
    await loadTimesheetsForPeriod();
    await loadDashboard();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
    window.crmToast?.error?.(e.message);
  }
}

function initPayrollHubNav() {
  const update = () => {
    const hash = (window.location.hash || '#hub-resumo').replace('#', '');
    document.querySelectorAll('.payroll-nav-btn').forEach((b) => {
      const h = (b.getAttribute('href') || '').replace('#', '');
      const on = h === hash;
      b.classList.toggle('active', on);
    });
  };
  window.addEventListener('hashchange', update);
  document.querySelectorAll('.payroll-nav-btn').forEach((b) => {
    b.addEventListener('click', () => setTimeout(update, 50));
  });
  if (!window.location.hash) {
    window.history.replaceState(null, '', '#hub-resumo');
  }
  update();
}

function initPayrollMobileNav() {
  const sidebar = document.getElementById('payrollSidebar');
  const overlay = document.getElementById('mobileOverlay');
  const toggle = document.getElementById('mobileMenuToggle');
  if (!sidebar || !overlay || !toggle) return;

  /** Mesmo breakpoint que o CSS (#payrollShellLayoutLock): gaveta até 1024px */
  function isDrawerMode() {
    return window.innerWidth <= 1024;
  }

  function setOpen(open) {
    sidebar.classList.toggle('mobile-open', open);
    overlay.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', () => {
    setOpen(!sidebar.classList.contains('mobile-open'));
  });
  overlay.addEventListener('click', () => setOpen(false));
  window.addEventListener('resize', () => {
    if (!isDrawerMode()) setOpen(false);
  });

  sidebar.addEventListener('click', (e) => {
    const t = e.target.closest('a.nav-item');
    if (t && isDrawerMode()) setOpen(false);
  });

  document.getElementById('payrollSidebarLogout')?.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {}
    window.location.href = 'login.html';
  });

  function syncMobileHeaderAria() {
    const header = document.getElementById('mobileAppHeader');
    if (!header) return;
    header.setAttribute('aria-hidden', isDrawerMode() ? 'false' : 'true');
  }
  syncMobileHeaderAria();
  window.addEventListener('resize', syncMobileHeaderAria);
}

async function reloadAll() {
  await loadDashboard();
  await loadEmployees();
  await loadProjects();
  await loadPeriods();
}

document.getElementById('btnReloadAll')?.addEventListener('click', () => reloadAll());
document.getElementById('periodSelect')?.addEventListener('change', () => onPeriodChange());
document.getElementById('btnNewEmployee')?.addEventListener('click', () => openEmployeeModal(null));
document.getElementById('empCancel')?.addEventListener('click', () => closeEmployeeModal());
document.getElementById('empSave')?.addEventListener('click', () => saveEmployee());
document.getElementById('btnNewPeriod')?.addEventListener('click', () => openPeriodModal());
document.getElementById('btnDeletePeriod')?.addEventListener('click', async () => {
  if (!canManage || !selectedPeriodId) return;
  const p = selectedPeriodRecord();
  if (!p) return;
  const nm = p.name || `Período #${p.id}`;
  const dates = `${p.start_date} → ${p.end_date}`;
  if (
    !window.confirm(
      `Apagar o período «${nm}» (${dates})?\n\nTodas as linhas do quadro, reembolsos e descontos deste período serão eliminados. Esta ação não pode ser anulada.`
    )
  )
    return;
  try {
    await api('DELETE', `/periods/${selectedPeriodId}`);
    window.crmToast?.success?.('Período apagado.');
    await loadPeriods();
    await loadDashboard();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
});
document.getElementById('perCancel')?.addEventListener('click', () => closePeriodModal());
document.getElementById('perSave')?.addEventListener('click', () => savePeriod());
document.getElementById('btnAddTimesheetRow')?.addEventListener('click', () => {
  if (!canAddTimesheetRows()) {
    window.crmToast?.error?.(
      selectedPeriodRecord()?.status === 'closed'
        ? 'Período fechado — não é possível adicionar linhas novas (só alterar as existentes, com payroll.manage).'
        : 'Sem permissão para editar o quadro (payroll.view).'
    );
    return;
  }
  if (!selectedPeriodId) {
    window.crmToast?.error?.('Primeiro escolha um período na lista acima.');
    return;
  }
  appendTimesheetRow({ work_date: defaultWorkDate() });
  updatePeriodRunningTotalFromDom();
});
document.getElementById('btnSaveTimesheet')?.addEventListener('click', async () => {
  if (!selectedPeriodId) {
    window.crmToast?.error?.('Escolha um período antes de guardar.');
    return;
  }
  if (!canEditTimesheetGrid()) {
    window.crmToast?.error?.(
      selectedPeriodRecord()?.status === 'closed'
        ? 'Período fechado — só quem tem payroll.manage pode guardar alterações ao quadro.'
        : 'Sem permissão para guardar o quadro (payroll.view).'
    );
    return;
  }
  const bad = timesheetGridValidationIssues();
  if (bad.length) {
    window.crmToast?.error?.(bad[0] + (bad.length > 1 ? ` (+${bad.length - 1})` : ''));
    return;
  }
  const lines = collectLinesFromGrid();
  if (!lines.length) {
    window.crmToast?.error?.(
      'Nenhuma linha para guardar. Escolha funcionário e data, e preencha pelo menos diárias (1d/½), horas normais ou horas extra — ou escreva uma nota.'
    );
    return;
  }
  try {
    const j = await api('POST', `/periods/${selectedPeriodId}/timesheets/bulk`, { lines });
    const saved = Array.isArray(j.data) ? j.data.length : 0;
    if (saved < lines.length) {
      window.crmToast?.success?.(
        `Guardado ${saved} de ${lines.length} linha(s). Verifique datas dentro do período e funcionário em cada linha.`
      );
    } else {
      window.crmToast?.success?.('Quadro guardado');
    }
    await loadTimesheetsForPeriod();
    await loadPeriods(selectedPeriodId);
    await loadDashboard();
  } catch (e) {
    let msg = e.message || 'Erro ao guardar.';
    if (e.status === 403) {
      msg =
        e.payload?.required === 'payroll.view' || e.payload?.required === 'payroll.manage'
          ? 'Sem permissão para guardar o quadro. Confirme payroll.view na sua conta.'
          : 'Sem permissão para esta ação.';
    } else if (String(msg).includes('Já existe linha')) {
      msg =
        'Já existe uma linha para o mesmo funcionário, data e projeto neste período. Edite a linha existente ou escolha outro projeto/data.';
    } else if (String(msg).toLowerCase().includes('fora do período')) {
      msg =
        'A data de cada linha tem de estar entre o início e o fim do período. Corrija a coluna Data.';
    } else if (e.payload?.code === 'BULK_NO_ROWS_SAVED' || String(msg).includes('Nenhuma linha foi gravada')) {
      msg =
        e.payload?.error ||
        'Nenhuma linha foi gravada. Verifique funcionário, data dentro do período e que não há duplicados (mesmo dia + projeto).';
    }
    window.crmToast?.error?.(msg);
  }
});
document.getElementById('btnPreviewPayroll')?.addEventListener('click', () => fetchAndShowPreview(false));
document.getElementById('btnPreviewClose')?.addEventListener('click', () => fetchAndShowPreview(true));
document.getElementById('previewCloseOnly')?.addEventListener('click', () => closePreviewModal());
document.getElementById('previewCancelClose')?.addEventListener('click', () => closePreviewModal());
document.getElementById('previewSaveAdjustments')?.addEventListener('click', async () => {
  try {
    await saveAdjustmentsFromPreview();
    window.crmToast?.success?.('Reembolsos e descontos guardados');
    await fetchAndShowPreview(true);
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
});
document.getElementById('previewConfirmClose')?.addEventListener('click', () => confirmClosePeriod());
document.getElementById('btnReopenPeriod')?.addEventListener('click', async () => {
  if (!selectedPeriodId || !canManage) return;
  const p = selectedPeriodRecord();
  if (!p || p.status !== 'closed') return;
  if (
    !confirm(
      'Reabrir este período? O quadro volta a poder ser editado (conforme permissões). Confirma?'
    )
  ) {
    return;
  }
  try {
    await api('POST', `/periods/${selectedPeriodId}/reopen`);
    window.crmToast?.success?.('Período reaberto.');
    await loadPeriods();
    await loadDashboard();
    await loadTimesheetsForPeriod();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
});
document.getElementById('btnNewEmployeeEmpty')?.addEventListener('click', () => openEmployeeModal(null));
document.getElementById('btnReportAll')?.addEventListener('click', () =>
  runReportAll().catch((e) => window.crmToast?.error?.(e.message || 'Erro ao gerar relatório'))
);
document.getElementById('btnReportEmployees')?.addEventListener('click', () => runReportEmployees().catch((e) => window.crmToast?.error?.(e.message)));
document.getElementById('btnReportProjects')?.addEventListener('click', () => runReportProjects().catch((e) => window.crmToast?.error?.(e.message)));
document.getElementById('btnReportTotal')?.addEventListener('click', () => runReportTotal().catch((e) => window.crmToast?.error?.(e.message)));
document.getElementById('empQuickSave')?.addEventListener('click', () => quickSaveEmployee());

(async function boot() {
  initReportDates();
  initPayrollMobileNav();
  initPayrollHubNav();
  const ok = await loadSession();
  if (!ok) return;
  try {
    await reloadAll();
  } catch (e) {
    if (e.status === 403) showAuth('Acesso negado.');
    else if (e.payload?.code === 'PAYROLL_SCHEMA_MISSING') {
      /* banner visible */
    } else window.crmToast?.error?.(e.message);
  }
})();
