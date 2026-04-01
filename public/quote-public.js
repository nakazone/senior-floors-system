/* global fetch */
(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  const el = document.getElementById('content');

  const money = (n) =>
    '$' +
    (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function load() {
    if (!token || token.length < 16) {
      el.innerHTML = '<p class="text-red-600">Invalid or missing link.</p>';
      return;
    }
    const r = await fetch(`/api/public/quotes/${encodeURIComponent(token)}`);
    const j = await r.json();
    if (!r.ok || !j.success) {
      el.innerHTML = '<p class="text-red-600">Quote not found or link expired.</p>';
      return;
    }
    const q = j.data.quote;
    const items = j.data.items || [];
    const client = [q.customer_name, q.customer_email].filter(Boolean).join(' · ');
    const lines = items
      .map((it) => {
        const st = it.service_type ? `<span class="text-[11px] text-slate-500 block mb-0.5">${escapeHtml(it.service_type)}</span>` : '';
        const cn = String(it.catalog_customer_notes || '').trim();
        const ln = String(it.notes || '').trim();
        const extra = [];
        if (cn) extra.push(`<div class="text-[11px] text-slate-500 mt-1">${escapeHtml(cn)}</div>`);
        if (ln) extra.push(`<div class="text-[11px] text-slate-600 mt-1 italic">Comment: ${escapeHtml(ln)}</div>`);
        const nm = String(it.name || '').trim();
        const dc = String(it.description || '').trim();
        const title = nm || dc || String(it.floor_type || '') || 'Line item';
        const sub =
          nm && dc && dc !== nm
            ? `<div class="text-[12px] text-slate-600 mt-1 whitespace-pre-wrap">${escapeHtml(dc)}</div>`
            : '';
        return `
      <tr class="border-b border-slate-100 text-sm">
        <td class="py-2 pr-2">${st}<span class="font-medium text-slate-900">${escapeHtml(title)}</span>${sub}${extra.join('')}</td>
        <td class="py-2 text-right">${Number(it.quantity) || 0}</td>
        <td class="py-2 text-right">${money(it.rate)}</td>
        <td class="py-2 text-right font-medium">${money(it.amount)}</td>
      </tr>`;
      })
      .join('');

    const approved = String(q.status).toLowerCase() === 'approved';
    el.innerHTML = `
      <p class="text-slate-600 text-sm">${escapeHtml(client || 'Client')}</p>
      <p class="text-lg font-bold text-slate-900">Quote ${escapeHtml(q.quote_number || '#' + q.id)}</p>
      <p class="text-xs text-slate-500">Status: <span class="font-semibold capitalize">${escapeHtml(q.status)}</span>
        ${q.expiration_date ? ` · Expires ${escapeHtml(String(q.expiration_date).slice(0, 10))}` : ''}</p>
      <table class="w-full mt-4">
        <thead><tr class="text-left text-xs text-slate-500"><th class="pb-2">Description</th><th class="pb-2 text-right">Qty</th><th class="pb-2 text-right">Rate</th><th class="pb-2 text-right">Amount</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>
      <div class="border-t pt-4 space-y-1 text-sm">
        <div class="flex justify-between"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
        <div class="flex justify-between"><span>Tax</span><span>${money(q.tax_total)}</span></div>
        <div class="flex justify-between font-bold text-base"><span>Total</span><span>${money(q.total_amount)}</span></div>
      </div>
      ${q.notes ? `<div class="text-sm text-slate-600 mt-4"><strong>Notes</strong><br/>${escapeHtml(q.notes)}</div>` : ''}
      ${
        approved
          ? '<p class="text-green-700 font-semibold mt-4">Thank you — this quote is approved.</p>'
          : `<button type="button" id="btnApprove" class="mt-6 w-full py-3 rounded-xl bg-[#d6b598] text-[#1a2036] font-bold">Approve quote</button>`
      }
    `;

    const btn = document.getElementById('btnApprove');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const rr = await fetch(`/api/public/quotes/${encodeURIComponent(token)}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const jj = await rr.json();
        if (rr.ok && jj.success) {
          load();
        } else {
          btn.disabled = false;
          alert(jj.error || 'Could not approve.');
        }
      });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  load().catch(() => {
    el.innerHTML = '<p class="text-red-600">Could not load quote.</p>';
  });
})();
