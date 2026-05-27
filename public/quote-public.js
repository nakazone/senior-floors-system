/* global fetch, crmNotify */
(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  const docEl = document.getElementById('quoteDocument');
  const innerEl = document.getElementById('quoteDocumentInner');
  const actionsEl = document.getElementById('quoteActions');
  const approvedEl = document.getElementById('quoteApprovedMsg');
  const errorEl = document.getElementById('quoteError');
  const loadingEl = document.getElementById('quoteLoading');

  const COMPANY = {
    name: 'Senior Floors',
    tagline: 'Hardwood · LVP · Refinishing · Denver Metro',
    phone: '(720) 751-9813',
    email: 'contact@senior-floors.com',
  };

  const SECTION_DEFS = [
    { key: 'installation', label: 'Installation' },
    { key: 'sand_finish', label: 'Sand & Finishing' },
    { key: 'supply', label: 'Supply' },
    { key: 'products', label: 'Materials & products' },
  ];

  const money = (n) =>
    '$' +
    (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function defaultTerms() {
    return (
      'This quote is valid until the expiration date shown. Pricing assumes access to the job site and ' +
      'accurate measurements; changes in scope may require a revised quote. A signed approval or deposit ' +
      'may be required to schedule work.'
    );
  }

  /** Same section logic as quotePdf.js */
  function lineSection(it) {
    if (String(it.item_type || '').toLowerCase() === 'product') return 'products';
    const st = String(it.service_type || '').trim();
    if (!st) return 'installation';
    const lower = st.toLowerCase();
    if (lower === 'supply') return 'supply';
    if (lower.includes('sand') || lower.includes('finishing')) return 'sand_finish';
    return 'installation';
  }

  function groupItems(items) {
    const buckets = { installation: [], sand_finish: [], supply: [], products: [] };
    for (const it of items || []) {
      const k = lineSection(it);
      if (buckets[k]) buckets[k].push(it);
      else buckets.installation.push(it);
    }
    return SECTION_DEFS.filter((d) => buckets[d.key].length > 0).map((d) => ({
      label: d.label,
      items: buckets[d.key],
    }));
  }

  function renderLineRow(it) {
    const nameStr = String(it.name || '').trim();
    const descStr = String(it.description || '').trim();
    const headline =
      nameStr || (descStr ? descStr.split(/\n/)[0] : '') || String(it.floor_type || '') || 'Line item';
    let bodyStr = '';
    if (nameStr && descStr && descStr !== nameStr) {
      bodyStr = descStr;
    } else if (!nameStr && descStr && descStr.includes('\n')) {
      bodyStr = descStr.split(/\n/).slice(1).join('\n').trim();
    }
    const qty = Number(it.quantity) || 0;
    const rate = Number(it.rate ?? it.unit_price) || 0;
    const amt = Number(it.amount ?? it.total_price) || qty * rate;
    const ut = it.unit_type ? String(it.unit_type).replace(/_/g, ' ') : 'sq ft';
    const catalogNotes = String(it.catalog_customer_notes || '').trim();
    const lineComment = String(it.notes || '').trim();
    const detailParts = [];
    if (catalogNotes) detailParts.push(catalogNotes);
    if (lineComment) detailParts.push(`Comment: ${lineComment}`);
    const detailHtml = detailParts.length
      ? `<span class="qp-line__detail">${escapeHtml(detailParts.join(' — '))}</span>`
      : '';
    const bodyHtml = bodyStr ? `<span class="qp-line__body">${escapeHtml(bodyStr)}</span>` : '';

    return `<tr>
      <td>
        <span class="qp-line__title">${escapeHtml(headline)}</span>
        ${bodyHtml}
        ${detailHtml}
      </td>
      <td class="qp-num">${escapeHtml(`${qty} ${ut}`)}</td>
      <td class="qp-num">${escapeHtml(money(rate))}</td>
      <td class="qp-num qp-line__amt">${escapeHtml(money(amt))}</td>
    </tr>`;
  }

  function renderTableHeader() {
    return `<thead><tr>
      <th>Description</th>
      <th class="qp-num">Qty</th>
      <th class="qp-num">Rate</th>
      <th class="qp-num">Amount</th>
    </tr></thead>`;
  }

  function renderSections(items) {
    const sections = groupItems(items);
    if (!sections.length) {
      return '<p class="qp-empty">No line items.</p>';
    }
    return sections
      .map(
        (sec) => `
      <div class="qp-section">
        <h2 class="qp-section-title">${escapeHtml(sec.label)}</h2>
        <table class="qp-table">
          <colgroup>
            <col class="col-desc" />
            <col class="col-qty" />
            <col class="col-rate" />
            <col class="col-amt" />
          </colgroup>
          ${renderTableHeader()}
          <tbody>${sec.items.map(renderLineRow).join('')}</tbody>
        </table>
      </div>`
      )
      .join('');
  }

  function renderDocument(q, items) {
    const clientName = escapeHtml(q.customer_name || 'Client');
    const email = q.customer_email ? escapeHtml(String(q.customer_email)) : '';
    const phone = q.customer_phone ? escapeHtml(String(q.customer_phone)) : '';
    const issue = q.issue_date ? String(q.issue_date).slice(0, 10) : '';
    const exp = q.expiration_date ? String(q.expiration_date).slice(0, 10) : '';
    const sub = Number(q.subtotal) || 0;
    const tax = Number(q.tax_total) || 0;
    const total = Number(q.total_amount) || 0;
    const discType = q.discount_type === 'fixed' ? '$' : '%';
    const discVal = Number(q.discount_value) || 0;
    const discDisplay = discType === '$' ? money(discVal) : `${discVal}%`;
    const terms = escapeHtml((q.terms_conditions && String(q.terms_conditions).trim()) || defaultTerms());
    const notes = q.notes ? escapeHtml(String(q.notes)) : '';

    const panelMeta = [
      issue ? `<p>Issue: ${escapeHtml(issue)}</p>` : '',
      exp ? `<p>Expires: ${escapeHtml(exp)}</p>` : '',
      `<p>Status: ${escapeHtml(q.status || 'draft')}</p>`,
    ].join('');

    return `
      <header class="qp-header">
        <div class="qp-header__brand">
          <img class="qp-logo" src="/assets/SeniorFloors.png" alt="" width="68" height="68" onerror="this.style.display='none'" />
          <div class="qp-company">
            <h1 class="qp-company__name">${escapeHtml(COMPANY.name)}</h1>
            <p class="qp-company__tagline">${escapeHtml(COMPANY.tagline)}</p>
            <p class="qp-company__contact">${escapeHtml(COMPANY.phone)} · ${escapeHtml(COMPANY.email)}</p>
          </div>
        </div>
        <aside class="qp-quote-panel">
          <p class="qp-quote-panel__label">QUOTE</p>
          <p class="qp-quote-panel__number">${escapeHtml(q.quote_number || `Quote #${q.id}`)}</p>
          ${panelMeta}
        </aside>
      </header>

      <section class="qp-billto">
        <p class="qp-billto__label">Bill to</p>
        <p class="qp-billto__name">${clientName}</p>
        ${email ? `<p class="qp-billto__meta">${email}</p>` : ''}
        ${phone ? `<p class="qp-billto__meta">${phone}</p>` : ''}
      </section>

      ${renderSections(items)}

      <div class="qp-totals-wrap">
        <table class="qp-totals">
          <tbody>
            <tr><td>Subtotal</td><td>${money(sub)}</td></tr>
            <tr><td>Tax</td><td>${money(tax)}</td></tr>
            <tr><td>Discount (${escapeHtml(discType)})</td><td>${escapeHtml(discDisplay)}</td></tr>
          </tbody>
        </table>
        <p class="qp-totals-label">Quote total</p>
        <div class="qp-grand-total">
          <span class="qp-grand-total__label">TOTAL</span>
          <span class="qp-grand-total__value">${money(total)}</span>
        </div>
      </div>

      <section class="qp-terms">
        <h3 class="qp-block-title">Terms &amp; conditions</h3>
        <p class="qp-block-text">${terms}</p>
      </section>

      ${
        notes
          ? `<section class="qp-notes">
        <h3 class="qp-block-title">Notes</h3>
        <p class="qp-block-text">${notes}</p>
      </section>`
          : ''
      }
    `;
  }

  function renderActions(approved) {
    if (approved) {
      actionsEl.innerHTML = '';
      actionsEl.hidden = true;
      approvedEl.textContent = 'Thank you — this quote is approved.';
      approvedEl.hidden = false;
      return;
    }
    approvedEl.hidden = true;
    actionsEl.hidden = false;
    actionsEl.innerHTML = `
      <a
        class="qp-btn qp-btn--outline"
        href="/api/public/quotes/${encodeURIComponent(token)}/pdf"
        target="_blank"
        rel="noopener noreferrer"
      >Download PDF</a>
      <button type="button" class="qp-btn qp-btn--primary" id="btnApprove">Approve quote</button>
    `;
    const btn = document.getElementById('btnApprove');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const rr = await fetch(`/api/public/quotes/${encodeURIComponent(token)}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const jj = await rr.json();
          if (rr.ok && jj.success) {
            await load();
          } else {
            btn.disabled = false;
            const msg = jj.error || 'Could not approve.';
            if (typeof crmNotify === 'function') crmNotify(msg, 'error');
            else alert(msg);
          }
        } catch {
          btn.disabled = false;
          if (typeof crmNotify === 'function') crmNotify('Could not approve.', 'error');
          else alert('Could not approve.');
        }
      });
    }
  }

  function showError(msg) {
    loadingEl.hidden = true;
    docEl.hidden = true;
    actionsEl.hidden = true;
    approvedEl.hidden = true;
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    errorEl.hidden = false;
  }

  async function load() {
    if (!token || token.length < 16) {
      showError('Invalid or missing link.');
      return;
    }
    try {
      const r = await fetch(`/api/public/quotes/${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok || !j.success) {
        showError('Quote not found or link expired.');
        return;
      }
      const q = j.data.quote;
      const items = j.data.items || [];
      const approved = String(q.status).toLowerCase() === 'approved';

      loadingEl.hidden = true;
      errorEl.hidden = true;
      errorEl.classList.add('hidden');

      innerEl.innerHTML = renderDocument(q, items);
      docEl.hidden = false;
      renderActions(approved);
      document.title = `Quote ${q.quote_number || q.id} — Senior Floors`;
    } catch {
      showError('Could not load quote.');
    }
  }

  load();
})();
