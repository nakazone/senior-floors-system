/**
 * Centro de fornecedores: próximos pagamentos + notas/ficheiros por vendor.
 */
const fmt$ = (v) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(parseFloat(v) || 0);

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

let vendorsList = [];

async function loadVendorsOptions() {
  const res = await fetch('/api/vendors', { credentials: 'include' }).then((r) => r.json());
  vendorsList = res.success ? res.data || [] : [];
  const optMain =
    '<option value="">— Selecione —</option>' + vendorsList.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
  const optFilt = '<option value="">Todos</option>' + vendorsList.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
  const sel = document.getElementById('vhVendorSelect');
  const filt = document.getElementById('vhFilterVendor');
  if (sel) sel.innerHTML = optMain;
  if (filt) filt.innerHTML = optFilt;

  const params = new URLSearchParams(window.location.search);
  const pre = params.get('vendor');
  if (pre && /^\d+$/.test(pre)) {
    const id = parseInt(pre, 10);
    if (sel) sel.value = String(id);
    if (filt) filt.value = String(id);
    loadAttachments(id);
    const uz = document.getElementById('vhUploadZone');
    if (uz) uz.style.display = 'block';
  }
}

async function loadUpcoming() {
  const horizon = Math.min(366, Math.max(7, parseInt(document.getElementById('vhHorizon')?.value, 10) || 120));
  const vid = document.getElementById('vhFilterVendor')?.value;
  const tbody = document.getElementById('vhUpcomingBody');
  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted)">A carregar…</td></tr>';
  const res = await fetch(`/api/vendors/upcoming-payments?days=${horizon}`, { credentials: 'include' }).then((r) => r.json());
  if (!res.success) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--sf-bad)">${escapeHtml(res.error || 'Erro')}</td></tr>`;
    return;
  }
  let rows = res.data || [];
  if (vid) rows = rows.filter((x) => String(x.vendor_id) === String(vid));
  tbody.innerHTML = rows.length
    ? rows
        .map((r) => {
          const tipo =
            r.kind === 'recurring'
              ? `Recorrente (${escapeHtml(r.recurrence_type || '')})`
              : 'Único';
          const atraso = r.overdue ? '<span class="vh-badge-atraso">Atrasado</span> ' : '';
          return `<tr class="vh-up-row" data-vendor-id="${r.vendor_id}" style="cursor:pointer">
          <td>${atraso}${escapeHtml(r.due_date)}</td>
          <td>${escapeHtml(r.vendor_name)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${fmt$(r.amount)}</td>
          <td>${tipo}</td>
          <td><a href="financial.html" class="btn btn-sm btn-secondary" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation()">Financeiro</a></td>
        </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" style="color:var(--text-muted)">Nenhum pagamento no horizonte (ou filtro sem resultados)</td></tr>';

  document.querySelectorAll('.vh-up-row').forEach((tr) => {
    tr.addEventListener('click', () => {
      const id = tr.getAttribute('data-vendor-id');
      if (!id) return;
      const sel = document.getElementById('vhVendorSelect');
      if (sel) sel.value = id;
      document.getElementById('vhUploadZone').style.display = 'block';
      loadAttachments(parseInt(id, 10));
      sel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

async function loadAttachments(vendorId) {
  const listEl = document.getElementById('vhAttachmentsList');
  const thumbs = document.getElementById('vhThumbs');
  if (!vendorId) {
    listEl.innerHTML = '<li style="color:var(--text-muted);border:none">Selecione um fornecedor</li>';
    thumbs.innerHTML = '';
    return;
  }
  listEl.innerHTML = '<li style="border:none;color:var(--text-muted)">A carregar…</li>';
  thumbs.innerHTML = '';
  const res = await fetch(`/api/vendors/${vendorId}/invoices`, { credentials: 'include' }).then((r) => r.json());
  const items = res.success ? res.data || [] : [];
  if (!items.length) {
    listEl.innerHTML = '<li style="color:var(--text-muted);border:none">Nenhum ficheiro ainda</li>';
    return;
  }
  listEl.innerHTML = items
    .map((a) => {
      const name = escapeHtml(a.original_name || a.file_url || 'ficheiro');
      const memo = a.memo ? `<div style="font-size:12px;color:var(--text-muted)">${escapeHtml(a.memo)}</div>` : '';
      const when = a.created_at ? String(a.created_at).slice(0, 19).replace('T', ' ') : '';
      const isPdf = /\.pdf$/i.test(a.file_url || '') || (a.original_name || '').toLowerCase().endsWith('.pdf');
      const open = isPdf
        ? `<a href="${escapeHtml(a.file_url)}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="padding:4px 8px;font-size:11px">Abrir</a>`
        : `<button type="button" class="btn btn-sm btn-secondary vh-thumb-open" data-src="${escapeHtml(a.file_url)}" style="padding:4px 8px;font-size:11px">Ver</button>`;
      return `<li>
        <strong>${name}</strong> <span style="font-size:11px;color:var(--text-muted)">${escapeHtml(when)}</span>
        ${memo}
        <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
          ${open}
          <button type="button" class="btn btn-sm btn-danger vh-del-att" data-att="${a.id}" style="padding:4px 8px;font-size:11px">Eliminar</button>
        </div>
      </li>`;
    })
    .join('');

  thumbs.innerHTML = items
    .filter((a) => /\.(png|jpe?g|gif|webp)$/i.test(a.file_url || a.original_name || ''))
    .map(
      (a) =>
        `<img class="vh-thumb vh-thumb-open" src="${escapeHtml(a.file_url)}" alt="" data-src="${escapeHtml(a.file_url)}" />`
    )
    .join('');

  document.querySelectorAll('.vh-del-att').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const attId = btn.getAttribute('data-att');
      if (!attId || !confirm('Eliminar este ficheiro?')) return;
      const r = await fetch(`/api/vendors/${vendorId}/invoices/${attId}`, { method: 'DELETE', credentials: 'include' }).then((x) =>
        x.json()
      );
      if (r.success) loadAttachments(vendorId);
      else alert(r.error || 'Erro');
    });
  });

  document.querySelectorAll('.vh-thumb-open').forEach((el) => {
    el.addEventListener('click', () => {
      const src = el.getAttribute('data-src');
      if (!src) return;
      if (/\.pdf$/i.test(src)) {
        window.open(src, '_blank');
        return;
      }
      document.getElementById('vhLightboxImg').src = src;
      document.getElementById('vhLightbox').classList.add('on');
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const auth = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
  if (!auth.authenticated) {
    window.location.href = 'login.html';
    return;
  }

  const mt = document.getElementById('mobileMenuToggle');
  const sb = document.getElementById('vhSidebar');
  const ov = document.getElementById('mobileOverlay');
  if (mt && sb && ov) {
    mt.addEventListener('click', () => {
      const open = sb.classList.toggle('mobile-open');
      ov.classList.toggle('active', open);
      mt.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    ov.addEventListener('click', () => {
      sb.classList.remove('mobile-open');
      ov.classList.remove('active');
    });
  }

  document.getElementById('vhLightboxClose')?.addEventListener('click', () => {
    document.getElementById('vhLightbox').classList.remove('on');
  });

  await loadVendorsOptions();
  await loadUpcoming();

  document.getElementById('vhRefreshUpcoming')?.addEventListener('click', () => loadUpcoming());
  document.getElementById('vhFilterVendor')?.addEventListener('change', () => loadUpcoming());
  document.getElementById('vhHorizon')?.addEventListener('change', () => loadUpcoming());

  document.getElementById('vhVendorSelect')?.addEventListener('change', (e) => {
    const id = parseInt(e.target.value, 10);
    if (!id) {
      document.getElementById('vhUploadZone').style.display = 'none';
      loadAttachments(0);
      return;
    }
    document.getElementById('vhUploadZone').style.display = 'block';
    loadAttachments(id);
  });

  document.getElementById('vhUploadBtn')?.addEventListener('click', async () => {
    const sel = document.getElementById('vhVendorSelect');
    const vendorId = parseInt(sel?.value, 10);
    const fileInput = document.getElementById('vhFile');
    if (!vendorId) {
      alert('Escolha um fornecedor');
      return;
    }
    if (!fileInput?.files?.[0]) {
      alert('Escolha um ficheiro');
      return;
    }
    const form = new FormData();
    form.append('file', fileInput.files[0]);
    const memo = document.getElementById('vhMemo')?.value?.trim();
    if (memo) form.append('memo', memo);
    const raw = await fetch(`/api/vendors/${vendorId}/invoices`, { method: 'POST', credentials: 'include', body: form });
    const j = await raw.json().catch(() => ({}));
    if (raw.ok && j.success) {
      fileInput.value = '';
      document.getElementById('vhMemo').value = '';
      loadAttachments(vendorId);
    } else alert(j.error || `Erro (${raw.status})`);
  });
});
