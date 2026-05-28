/* global crmNotify */
(function () {
  async function load() {
    const st = document.getElementById('filterSt').value;
    const url = st ? `/api/estimate-requests?status=${encodeURIComponent(st)}` : '/api/estimate-requests';
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json();
    const tbody = document.getElementById('estTbody');
    if (!j.success || !j.data.length) {
      tbody.innerHTML = '<tr><td colspan="8">Nenhum pedido.</td></tr>';
      return;
    }
    tbody.innerHTML = j.data
      .map(
        (e) => `<tr>
          <td><strong>${e.ref_number}</strong></td>
          <td>${e.company || e.first_name + ' ' + e.last_name}</td>
          <td>${(e.address || '').slice(0, 40)}</td>
          <td>${e.area_sqft || '—'}</td>
          <td>${e.status}</td>
          <td>${e.lead_id ? `<a href="dashboard.html?page=leads">#${e.lead_id}</a>` : '—'}</td>
          <td>${String(e.created_at).slice(0, 10)}</td>
          <td><select data-id="${e.id}" class="st-sel">
            <option value="pending" ${e.status === 'pending' ? 'selected' : ''}>pending</option>
            <option value="in_review" ${e.status === 'in_review' ? 'selected' : ''}>in_review</option>
            <option value="quoted" ${e.status === 'quoted' ? 'selected' : ''}>quoted</option>
            <option value="closed" ${e.status === 'closed' ? 'selected' : ''}>closed</option>
          </select></td>
        </tr>`
      )
      .join('');
    tbody.querySelectorAll('.st-sel').forEach((sel) => {
      sel.addEventListener('change', async () => {
        await fetch(`/api/estimate-requests/${sel.dataset.id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: sel.value }),
        });
        crmNotify('Status atualizado.', 'success');
      });
    });
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    document.getElementById('filterSt').addEventListener('change', load);
    load();
  }

  init();
})();
