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
    p.style.display = p.id === `tab-${tab}` ? 'block' : 'none';
  });
}

async function loadProject() {
  if (!projectId) {
    window.location.href = 'projects.html';
    return;
  }
  const [projRes, plRes, checkRes, photoRes] = await Promise.all([
    fetch(`/api/projects/${projectId}`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/profitability`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/checklist`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/photos`, { credentials: 'include' }),
  ]);
  const [projData, plJson, checkJson, photoJson] = await Promise.all([
    projRes.json(),
    plRes.json(),
    checkRes.json(),
    photoRes.json(),
  ]);
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

function renderHeader(p) {
  document.getElementById('pd-title').textContent = p.name || `Projeto #${p.id}`;
  document.getElementById('pd-crumb-name').textContent = p.name || `#${p.id}`;
  const sel = document.getElementById('pd-status');
  if (sel && sel.options.length === 0) {
    ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'].forEach((st) => {
      const o = document.createElement('option');
      o.value = st;
      o.textContent = st;
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

function renderOverviewTab(p, pl) {
  const el = document.getElementById('tab-overview');
  if (!el) return;
  const daysEst = p.days_estimated != null ? parseInt(p.days_estimated, 10) : null;
  const start = p.start_date ? new Date(`${p.start_date}T12:00:00`) : null;
  let dayLine = '';
  if (start && daysEst) {
    const now = new Date();
    const elapsed = Math.max(1, Math.ceil((now - start) / 86400000));
    dayLine = `<p style="font-size:13px;color:var(--sf-navy2)">Dia <strong>${elapsed}</strong> de <strong>${daysEst}</strong> estimados</p>`;
  }
  const bs = pl?.by_service || {};
  const supply = bs.supply || {};
  const inst = bs.installation || {};
  const sand = bs.sand_finish || {};
  const totals = pl?.totals || {};
  el.innerHTML = `
    <div class="sf-card" style="margin-bottom:12px">
      <p style="margin:0 0 8px;font-size:13px;color:var(--sf-muted)">${escapeHtml(p.address || 'Sem endereço')} · ${escapeHtml(p.flooring_type || '—')} · ${p.total_sqft != null ? `${p.total_sqft} sqft` : '—'}</p>
      <p style="margin:0;font-size:12px;color:var(--sf-muted)">Início: ${p.start_date || '—'} · Fim previsto: ${p.end_date_estimated || '—'}</p>
      ${dayLine}
    </div>
    <div class="pd-pl-grid">
      <div class="sf-card"><div class="sf-card-badge">Supply</div><div class="sf-card-val">${fmt$(supply.revenue)}</div><div style="font-size:11px;color:var(--sf-muted)">Custo ${fmt$(supply.total_cost)} · Margem ${fmtPct(supply.margin_pct)}</div></div>
      <div class="sf-card"><div class="sf-card-badge">Installation</div><div class="sf-card-val">${fmt$(inst.revenue)}</div><div style="font-size:11px;color:var(--sf-muted)">Custo ${fmt$(inst.total_cost)} · Margem ${fmtPct(inst.margin_pct)}</div></div>
      <div class="sf-card"><div class="sf-card-badge">Sand &amp; finish</div><div class="sf-card-val">${fmt$(sand.revenue)}</div><div style="font-size:11px;color:var(--sf-muted)">Custo ${fmt$(sand.total_cost)} · Margem ${fmtPct(sand.margin_pct)}</div></div>
    </div>
    <div class="sf-card sf-ok">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;font-size:13px;font-weight:600;color:var(--sf-navy)">
        <div>Receita total<br><span style="font-size:1.1rem">${fmt$(totals.total_revenue)}</span></div>
        <div>Custo total<br><span style="font-size:1.1rem">${fmt$(totals.total_cost)}</span></div>
        <div>Lucro bruto<br><span style="font-size:1.1rem">${fmt$(totals.gross_profit)}</span></div>
        <div>Margem %<br><span style="font-size:1.1rem">${fmtPct(totals.margin_pct)}</span></div>
      </div>
    </div>
    ${
      pl?.profitability
        ? (() => {
            const pr = pl.profitability;
            const row = (label, pj, ac) => {
              const diff = ac - pj;
              const warn = diff > 0.005 ? ' ⚠' : '';
              return `<tr><td>${label}</td><td>${fmt$(pj)}</td><td>${fmt$(ac)}</td><td style="font-weight:600">${fmt$(diff)}${warn}</td></tr>`;
            };
            return `
    <div class="sf-card" style="margin-top:12px">
      <div class="sf-card-badge">Projetado vs real</div>
      <table class="pd-table" style="margin-top:8px">
        <thead><tr><th></th><th>Projetado</th><th>Real</th><th>Variação</th></tr></thead>
        <tbody>
          ${row('Labor', pr.projected.labor, pr.actual.labor)}
          ${row('Material', pr.projected.material, pr.actual.material)}
          ${row('Adicional', pr.projected.additional, pr.actual.additional)}
          <tr style="font-weight:700"><td>Total</td><td>${fmt$(pr.projected.total)}</td><td>${fmt$(pr.actual.total)}</td><td>${fmt$(pr.variance.cost_diff)} (${fmtPct(pr.variance.cost_diff_pct)})</td></tr>
          <tr><td>Lucro</td><td>${fmt$(pr.projected.profit)}</td><td>${fmt$(pr.actual.profit)}</td><td>${fmt$(pr.actual.profit - pr.projected.profit)}</td></tr>
          <tr><td>Margem</td><td>${fmtPct(pr.projected.margin_pct)}</td><td>${fmtPct(pr.actual.margin_pct)}</td><td>${fmtPct(pr.actual.margin_pct - pr.projected.margin_pct)} pp</td></tr>
        </tbody>
      </table>
      <p style="font-size:12px;margin-top:10px;color:var(--sf-muted)">Duração: <strong>${pr.days_estimated || '—'}</strong> dias estimados / <strong>${pr.days_actual || '—'}</strong> reais → <strong>${pr.days_variance >= 0 ? '+' : ''}${pr.days_variance}</strong> dia(s)</p>
    </div>`;
          })()
        : ''
    }
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
    ${costSection('labor', 'Mão de obra (labor)', labor, sumLabor, 'labor')}
    ${costSection('material', 'Materiais (stock)', [], sumMat, 'material', materials)}
    ${costSection('additional', 'Adicional', additional, sumAdd, 'additional')}
  `;
  el.querySelectorAll('.pd-collapsible-h').forEach((h) => {
    h.addEventListener('click', () => h.closest('.pd-collapsible').classList.toggle('open'));
  });
  wireCostForms(el, p);
  document.getElementById('btn-sync-payroll-tab')?.addEventListener('click', syncPayroll);
}

function costSection(key, title, rows, sum, type, matRows) {
  const isMat = type === 'material';
  const list = isMat ? matRows : rows;
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
          ${isMat ? materialFormFields() : type === 'labor' ? laborFormFields() : additionalFormFields()}
          <button type="button" class="pd-btn pd-btn--primary" style="grid-column:1/-1" data-submit-cost="${type}">+ Adicionar</button>
        </div>
      </div>
    </div>`;
}

function laborFormFields() {
  return `
    <select data-f="is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <input type="text" data-f="description" placeholder="Descrição" />
    <input type="number" data-f="quantity" placeholder="Qtd" step="0.01" value="1" />
    <input type="text" data-f="unit" placeholder="Unidade (dias, h…)" />
    <input type="number" data-f="unit_cost" placeholder="Custo unit." step="0.01" />
    <select data-f="service_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>`;
}

function materialFormFields() {
  return `
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
    return `<tr>
      <td>${escapeHtml(r.product_name)}</td><td>${escapeHtml(r.service_category)}</td>
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

function wireCostForms(root) {
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
    <div style="display:flex;flex-wrap:wrap;gap:16px">
      ${galleryCol('before', 'Antes')}
      ${galleryCol('during', 'Durante')}
      ${galleryCol('after', 'Depois')}
    </div>
    <div class="sf-card" style="margin-top:20px">
      <h3 style="margin:0 0 10px;font-size:15px;color:var(--sf-navy)">Publicar no portfólio Senior Floors</h3>
      <input type="text" id="portfolio-title" placeholder="Título" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border-radius:6px;border:1px solid var(--sf-border)" />
      <textarea id="portfolio-desc" placeholder="Descrição" style="width:100%;box-sizing:border-box;min-height:64px;margin-bottom:8px;padding:8px;border-radius:6px;border:1px solid var(--sf-border)"></textarea>
      <p style="font-size:12px;color:var(--sf-muted)" id="portfolio-selected-count">Fotos para portfólio: 0</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        <button type="button" class="pd-btn pd-btn--primary" id="btn-publish-portfolio">🌐 Publicar no site</button>
        <button type="button" class="pd-btn" id="btn-copy-photo-urls">Copiar URLs</button>
      </div>
      <p id="portfolio-live-status" style="font-size:12px;font-weight:600;color:var(--sf-ok);margin-top:10px;min-height:1em"></p>
      <p style="font-size:11px;color:var(--sf-muted);margin-top:12px;line-height:1.4" id="portfolio-hint">
        Sem webhook: copie as URLs e publique manualmente em <a href="https://senior-floors.com" target="_blank" rel="noopener">senior-floors.com</a>. Configure <code>PORTFOLIO_WEBHOOK_URL</code> no servidor para sync automático.
      </p>
    </div>`;
  el.querySelectorAll('.pd-add-photo').forEach((box) => {
    box.addEventListener('click', () => {
      galleryUploadPhase = box.getAttribute('data-phase') || 'during';
      document.getElementById('pd-file-input').click();
    });
  });
  el.querySelectorAll('.pd-gallery-grid img').forEach((img) => {
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
  return `<div class="pd-gallery-col">
    <h3 style="font-size:14px;color:var(--sf-navy);margin:0 0 8px">${label}</h3>
    <div class="pd-gallery-grid">${thumbs}<div class="pd-add-photo" data-phase="${phase}">+</div></div>
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
      btn.textContent = '🔄 Folha de pagamento';
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

document.getElementById('btn-tab-checklist')?.addEventListener('click', () => switchTab('checklist'));
document.getElementById('btn-tab-pl')?.addEventListener('click', () => switchTab('overview'));
document.getElementById('btn-tab-gallery')?.addEventListener('click', () => switchTab('gallery'));

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-sync-payroll')?.addEventListener('click', syncPayroll);
  fetch('/api/auth/session', { credentials: 'include' }).then(async (r) => {
    const j = await r.json();
    if (!j.authenticated) {
      window.location.href = '/login.html';
      return;
    }
    loadProject();
  });
});
