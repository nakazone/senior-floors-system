/**
 * Construction payroll UI — /payroll-module.html
 */
const CP = '/api/construction-payroll';

let canManage = false;
let role = '';
let permissionKeys = [];
let employees = [];
let employeesById = {};
let periods = [];
let projects = [];
let selectedPeriodId = null;
let currentPeriod = null;
let timesheetRows = [];
let closingPeriodMode = false;

function money(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(x);
}

function calcLinePreview(empId, row) {
  const emp = employeesById[empId];
  if (!emp) return 0;
  const pt = String(emp.payment_type || 'daily').toLowerCase();
  const dr = Number(emp.daily_rate) || 0;
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
  ['btnNewEmployee', 'btnNewPeriod'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  });
  refreshPeriodActions();
}

function refreshPeriodActions() {
  const ids = ['btnPreviewClose', 'btnAddTimesheetRow', 'btnSaveTimesheet'];
  if (!currentPeriod) {
    ids.forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    return;
  }
  const closed = currentPeriod.status === 'closed';
  const show = canManage && !closed;
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  });
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
  permissionKeys = Array.isArray(j.user?.permissions) ? j.user.permissions : [];
  const hasView = role === 'admin' || permissionKeys.includes('payroll.view');
  canManage = role === 'admin' || permissionKeys.includes('payroll.manage');
  if (!hasView) {
    showAuth('You do not have payroll.view permission.');
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
    if (e.status === 403) showAuth('Access denied.');
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
}

async function loadProjects() {
  const r = await fetch('/api/projects?limit=100', { credentials: 'include' });
  const j = await r.json();
  projects = j.data || [];
}

async function loadPeriods() {
  const j = await api('GET', '/periods');
  periods = j.data || [];
  const sel = document.getElementById('periodSelect');
  const prev = selectedPeriodId;
  sel.innerHTML = '<option value="">Select period…</option>';
  periods.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = `${p.name} (${p.start_date} → ${p.end_date}) [${p.status}]`;
    sel.appendChild(opt);
  });
  if (prev && periods.some((p) => p.id === prev)) {
    sel.value = String(prev);
  } else if (periods.length) {
    const open = periods.find((p) => p.status === 'open');
    sel.value = String((open || periods[0]).id);
  }
  selectedPeriodId = sel.value ? parseInt(sel.value, 10) : null;
  await onPeriodChange();
}

function renderEmployeeTable() {
  const tb = document.getElementById('employeeTbody');
  tb.innerHTML = '';
  employees.forEach((e) => {
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-100';
    tr.innerHTML = `
      <td class="px-3 py-2 font-medium">${escapeHtml(e.name)}</td>
      <td class="px-3 py-2">${escapeHtml(e.role || '—')}</td>
      <td class="px-3 py-2">${escapeHtml(e.payment_type)}</td>
      <td class="px-3 py-2 text-right">${money(e.daily_rate)}</td>
      <td class="px-3 py-2 text-right">${money(e.hourly_rate)}</td>
      <td class="px-3 py-2 text-right">${money(e.overtime_rate)}</td>
      <td class="px-3 py-2">${escapeHtml(e.payment_method || '—')}</td>
      <td class="px-3 py-2">${e.is_active ? 'Yes' : 'No'}</td>
      <td class="px-3 py-2 text-right">
        ${canManage ? `<button type="button" class="text-[#1a2036] font-semibold underline text-xs emp-edit" data-id="${e.id}">Edit</button>` : '—'}
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
  return (
    '<option value="">—</option>' +
    active
      .map((e) => `<option value="${e.id}"${e.id === selectedId ? ' selected' : ''}>${escapeHtml(e.name)}</option>`)
      .join('')
  );
}

function projectOptionsHtml(selectedId) {
  return (
    '<option value="">—</option>' +
    projects
      .map(
        (p) =>
          `<option value="${p.id}"${p.id === selectedId ? ' selected' : ''}>${escapeHtml(p.project_number || '#' + p.id)}</option>`
      )
      .join('')
  );
}

function defaultWorkDate() {
  if (!currentPeriod) return new Date().toISOString().slice(0, 10);
  const s = String(currentPeriod.start_date).slice(0, 10);
  const e = String(currentPeriod.end_date).slice(0, 10);
  const t = new Date().toISOString().slice(0, 10);
  if (t >= s && t <= e) return t;
  return s;
}

function refreshRowAmount(tr) {
  const empId = parseInt(tr.querySelector('.ts-emp').value, 10);
  const row = {
    days_worked: tr.querySelector('.ts-days').value,
    regular_hours: tr.querySelector('.ts-reg').value,
    overtime_hours: tr.querySelector('.ts-ot').value,
  };
  const amt = calcLinePreview(empId, row);
  tr.querySelector('.ts-amt').textContent = money(amt);
  updatePeriodRunningTotalFromDom();
}

function bindRowEvents(tr) {
  tr.querySelectorAll('.ts-date, .ts-emp, .ts-days, .ts-reg, .ts-ot').forEach((el) => {
    el.addEventListener('change', () => refreshRowAmount(tr));
    el.addEventListener('input', () => refreshRowAmount(tr));
  });
  tr.querySelector('.ts-full').addEventListener('click', () => {
    tr.querySelector('.ts-days').value = '1';
    refreshRowAmount(tr);
  });
  tr.querySelector('.ts-half').addEventListener('click', () => {
    tr.querySelector('.ts-days').value = '0.5';
    refreshRowAmount(tr);
  });
  tr.querySelector('.ts-del').addEventListener('click', async () => {
    const id = tr.dataset.lineId;
    if (!id) {
      tr.remove();
      updatePeriodRunningTotalFromDom();
      return;
    }
    if (!canManage) return;
    if (!window.confirm('Delete this timesheet line?')) return;
    try {
      await api('DELETE', `/timesheets/${id}`);
      window.crmToast?.success?.('Line deleted');
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
  const locked = currentPeriod?.status === 'closed';
  const dis = locked || !canManage ? ' disabled' : '';
  tr.innerHTML = `
    <td class="px-2 py-1"><input type="date" class="ts-date w-full border rounded px-1 py-1 text-xs"${dis} value="${data?.work_date || ''}" /></td>
    <td class="px-2 py-1"><select class="ts-emp w-full border rounded px-1 py-1 text-xs"${dis}>${employeeOptionsHtml(data?.employee_id)}</select></td>
    <td class="px-2 py-1"><select class="ts-proj w-full border rounded px-1 py-1 text-xs"${dis}>${projectOptionsHtml(data?.project_id)}</select></td>
    <td class="px-2 py-1"><input type="number" step="0.25" min="0" class="ts-days w-full border rounded px-1 py-1 text-xs"${dis} value="${data?.days_worked ?? ''}" /></td>
    <td class="px-2 py-1"><input type="number" step="0.25" min="0" class="ts-reg w-full border rounded px-1 py-1 text-xs"${dis} value="${data?.regular_hours ?? ''}" /></td>
    <td class="px-2 py-1"><input type="number" step="0.25" min="0" class="ts-ot w-full border rounded px-1 py-1 text-xs"${dis} value="${data?.overtime_hours ?? ''}" /></td>
    <td class="px-2 py-1"><input type="text" class="ts-notes w-full border rounded px-1 py-1 text-xs"${dis} value="" /></td>
    <td class="px-2 py-1 text-right ts-amt text-xs font-medium">${money(data?.calculated_amount ?? 0)}</td>
    <td class="px-2 py-1 whitespace-nowrap">
      <button type="button" class="ts-full px-1 py-0.5 text-[10px] border rounded${locked || !canManage ? ' opacity-40' : ''}" ${locked || !canManage ? 'disabled' : ''}>1d</button>
      <button type="button" class="ts-half px-1 py-0.5 text-[10px] border rounded${locked || !canManage ? ' opacity-40' : ''}" ${locked || !canManage ? 'disabled' : ''}>½</button>
      <button type="button" class="ts-del px-1 py-0.5 text-[10px] border rounded text-red-700${locked || !canManage ? ' opacity-40' : ''}" ${locked || !canManage ? 'disabled' : ''}>×</button>
    </td>`;
  tb.appendChild(tr);
  if (data?.notes) tr.querySelector('.ts-notes').value = data.notes;
  bindRowEvents(tr);
  refreshRowAmount(tr);
}

function updatePeriodRunningTotalFromDom() {
  let sum = 0;
  document.querySelectorAll('#timesheetBody tr').forEach((tr) => {
    const empId = parseInt(tr.querySelector('.ts-emp').value, 10);
    const row = {
      days_worked: tr.querySelector('.ts-days').value,
      regular_hours: tr.querySelector('.ts-reg').value,
      overtime_hours: tr.querySelector('.ts-ot').value,
    };
    sum += calcLinePreview(empId, row);
  });
  document.getElementById('periodRunningTotal').textContent = money(sum);
}

async function loadTimesheetsForPeriod() {
  document.getElementById('timesheetBody').innerHTML = '';
  if (!selectedPeriodId) {
    currentPeriod = null;
    document.getElementById('periodMeta').textContent = '';
    document.getElementById('periodLockBadge').classList.add('hidden');
    return;
  }
  const j = await api('GET', `/periods/${selectedPeriodId}/timesheets`);
  currentPeriod = j.period;
  timesheetRows = j.data || [];
  const p = currentPeriod;
  document.getElementById('periodMeta').textContent = p
    ? `Frequency: ${p.frequency} · ${p.start_date} → ${p.end_date} · Status: ${p.status}`
    : '';
  const badge = document.getElementById('periodLockBadge');
  if (p?.status === 'closed') badge.classList.remove('hidden');
  else badge.classList.add('hidden');

  timesheetRows.forEach((row) => appendTimesheetRow(row));
  updatePeriodRunningTotalFromDom();
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
    const work_date = tr.querySelector('.ts-date').value;
    const employee_id = tr.querySelector('.ts-emp').value;
    const projectSel = tr.querySelector('.ts-proj').value;
    const days_worked = tr.querySelector('.ts-days').value;
    const regular_hours = tr.querySelector('.ts-reg').value;
    const overtime_hours = tr.querySelector('.ts-ot').value;
    const notes = tr.querySelector('.ts-notes').value;
    const id = tr.dataset.lineId;
    if (!employee_id || !work_date) return;
    const o = {
      employee_id: parseInt(employee_id, 10),
      project_id: projectSel ? parseInt(projectSel, 10) : null,
      work_date,
      days_worked: days_worked === '' ? 0 : Number(days_worked),
      regular_hours: regular_hours === '' ? 0 : Number(regular_hours),
      overtime_hours: overtime_hours === '' ? 0 : Number(overtime_hours),
      notes: notes || null,
    };
    if (id) o.id = parseInt(id, 10);
    lines.push(o);
  });
  return lines;
}

function openEmployeeModal(editId) {
  const m = document.getElementById('empModal');
  document.getElementById('empFormErr').classList.add('hidden');
  document.getElementById('empEditId').value = editId || '';
  document.getElementById('empModalTitle').textContent = editId ? 'Edit employee' : 'New employee';
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
    document.getElementById('empActive').checked = !!e.is_active;
  } else {
    ['empName', 'empRole', 'empPhone', 'empEmail', 'empPayMethod'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    document.getElementById('empPayType').value = 'daily';
    document.getElementById('empDaily').value = '0';
    document.getElementById('empHourly').value = '0';
    document.getElementById('empOt').value = '0';
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
  };
  if (editId) {
    body.is_active = document.getElementById('empActive').checked;
  }
  if (!body.name) {
    err.textContent = 'Name is required.';
    err.classList.remove('hidden');
    return;
  }
  try {
    if (editId) {
      await api('PUT', `/employees/${editId}`, body);
      window.crmToast?.success?.('Employee updated');
    } else {
      await api('POST', '/employees', body);
      window.crmToast?.success?.('Employee created');
    }
    closeEmployeeModal();
    await loadEmployees();
    await loadTimesheetsForPeriod();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
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
    err.textContent = 'Name is required.';
    err.classList.remove('hidden');
    return;
  }
  try {
    const j = await api('POST', '/periods', body);
    closePeriodModal();
    window.crmToast?.success?.('Period created');
    selectedPeriodId = j.data?.id;
    await loadPeriods();
    document.getElementById('periodSelect').value = String(selectedPeriodId);
    await onPeriodChange();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
}

function fillPreviewModal(data, opts) {
  closingPeriodMode = !!(opts && opts.closing);
  const tbody = document.getElementById('previewTbody');
  tbody.innerHTML = '';
  (data.by_employee || []).forEach((row) => {
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-100';
    tr.innerHTML = `<td class="px-3 py-2">${escapeHtml(row.name)}</td>
      <td class="px-3 py-2 text-right">${row.line_count}</td>
      <td class="px-3 py-2 text-right">${money(row.subtotal)}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('previewGrand').textContent = money(data.grand_total);
  document.getElementById('previewTitle').textContent = closingPeriodMode ? 'Close period — preview' : 'Payroll preview';
  document.getElementById('previewSubtitle').textContent = data.period
    ? `${data.period.name} (${data.period.start_date} → ${data.period.end_date})`
    : '';
  document.getElementById('previewCloseActions').classList.toggle('hidden', !closingPeriodMode);
  document.getElementById('previewCloseOnly').classList.toggle('hidden', closingPeriodMode);
}

function openPreviewModal() {
  const m = document.getElementById('previewModal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closePreviewModal() {
  const m = document.getElementById('previewModal');
  m.classList.add('hidden');
  m.classList.remove('flex');
  closingPeriodMode = false;
}

async function fetchAndShowPreview(closing) {
  if (!selectedPeriodId) {
    window.crmToast?.error?.('Select a period first.');
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
    await api('POST', `/periods/${selectedPeriodId}/close`);
    window.crmToast?.success?.('Period closed and locked.');
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
  document.getElementById('reportFrom').value = from.toISOString().slice(0, 10);
  document.getElementById('reportTo').value = t.toISOString().slice(0, 10);
}

function renderReportTable(title, headers, rows) {
  const out = document.getElementById('reportOut');
  let html = `<h3 class="font-bold text-slate-800 mb-2">${escapeHtml(title)}</h3><table class="w-full text-sm border"><thead><tr>`;
  headers.forEach((h) => {
    html += `<th class="px-2 py-2 text-left bg-slate-50 border-b">${escapeHtml(h)}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach((cells) => {
    html += '<tr class="border-t">';
    cells.forEach((c) => {
      html += `<td class="px-2 py-2 border-t border-slate-100">${c}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  out.innerHTML = html;
}

async function runReportEmployees() {
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  if (!from || !to) return window.crmToast?.error?.('Set from/to dates.');
  const j = await api('GET', `/reports/employee-earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const rows = (j.data || []).map((r) => [
    escapeHtml(r.name),
    escapeHtml(r.role || '—'),
    String(r.entries),
    money(r.total_earnings),
  ]);
  renderReportTable('Employee earnings', ['Employee', 'Role', 'Entries', 'Total'], rows);
}

async function runReportProjects() {
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  if (!from || !to) return window.crmToast?.error?.('Set from/to dates.');
  const j = await api('GET', `/reports/project-labor?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const rows = (j.data || []).map((r) => [
    r.project_id ? `#${r.project_id}` : '—',
    escapeHtml(r.project_number || 'Unassigned'),
    String(r.entries),
    money(r.labor_cost),
  ]);
  renderReportTable('Project labor cost', ['Project ID', 'Number', 'Entries', 'Labor cost'], rows);
}

async function runReportTotal() {
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  if (!from || !to) return window.crmToast?.error?.('Set from/to dates.');
  const j = await api('GET', `/reports/total-expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const d = j.data || {};
  document.getElementById('reportOut').innerHTML = `
    <h3 class="font-bold text-slate-800 mb-2">Total payroll expenses</h3>
    <p class="text-lg font-bold text-[#1a2036]">${money(d.total)}</p>
    <p class="text-sm text-slate-500">${d.line_count} lines · ${from} → ${to}</p>`;
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
document.getElementById('perCancel')?.addEventListener('click', () => closePeriodModal());
document.getElementById('perSave')?.addEventListener('click', () => savePeriod());
document.getElementById('btnAddTimesheetRow')?.addEventListener('click', () => {
  appendTimesheetRow({ work_date: defaultWorkDate() });
  updatePeriodRunningTotalFromDom();
});
document.getElementById('btnSaveTimesheet')?.addEventListener('click', async () => {
  if (!selectedPeriodId || !canManage) return;
  const lines = collectLinesFromGrid();
  try {
    await api('POST', `/periods/${selectedPeriodId}/timesheets/bulk`, { lines });
    window.crmToast?.success?.('Timesheet saved');
    await loadTimesheetsForPeriod();
    await loadPeriods();
    await loadDashboard();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
});
document.getElementById('btnPreviewPayroll')?.addEventListener('click', () => fetchAndShowPreview(false));
document.getElementById('btnPreviewClose')?.addEventListener('click', () => fetchAndShowPreview(true));
document.getElementById('previewCloseOnly')?.addEventListener('click', () => closePreviewModal());
document.getElementById('previewCancelClose')?.addEventListener('click', () => closePreviewModal());
document.getElementById('previewConfirmClose')?.addEventListener('click', () => confirmClosePeriod());
document.getElementById('btnReportEmployees')?.addEventListener('click', () => runReportEmployees().catch((e) => window.crmToast?.error?.(e.message)));
document.getElementById('btnReportProjects')?.addEventListener('click', () => runReportProjects().catch((e) => window.crmToast?.error?.(e.message)));
document.getElementById('btnReportTotal')?.addEventListener('click', () => runReportTotal().catch((e) => window.crmToast?.error?.(e.message)));

(async function boot() {
  initReportDates();
  const ok = await loadSession();
  if (!ok) return;
  try {
    await reloadAll();
  } catch (e) {
    if (e.status === 403) showAuth('Access denied.');
    else if (e.payload?.code === 'PAYROLL_SCHEMA_MISSING') {
      /* banner visible */
    } else window.crmToast?.error?.(e.message);
  }
})();
