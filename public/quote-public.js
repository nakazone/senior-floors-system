/* global fetch, crmNotify */
(function () {
  const params = new URLSearchParams(location.search);
  const legacyToken = params.get('t');
  const docEl = document.getElementById('quoteDocument');
  const innerEl = document.getElementById('quoteDocumentInner');
  const actionsEl = document.getElementById('quoteActions');
  const approvedEl = document.getElementById('quoteApprovedMsg');
  const errorEl = document.getElementById('quoteError');
  const loadingEl = document.getElementById('quoteLoading');

  const QUOTE_NUMBER_PATH_RE = /^\/(Q-\d{4}-\d+)\/?$/i;

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

  function resolvePublicQuoteAccess() {
    const pathMatch = location.pathname.match(QUOTE_NUMBER_PATH_RE);
    if (pathMatch) {
      return {
        mode: 'number',
        ref: pathMatch[1],
        apiBase: `/api/public/quotes/by-number/${encodeURIComponent(pathMatch[1])}`,
      };
    }
    if (legacyToken && legacyToken.length >= 16) {
      return {
        mode: 'token',
        ref: legacyToken,
        apiBase: `/api/public/quotes/${encodeURIComponent(legacyToken)}`,
      };
    }
    return null;
  }

  const access = resolvePublicQuoteAccess();

  function defaultTerms() {
    return (
      'This quote is valid until the expiration date shown. Pricing assumes access to the job site and ' +
      'standard subfloor conditions unless otherwise noted. Payment terms and schedule will be confirmed upon approval.'
    );
  }

  function lineSection(item) {
    if (item.item_type === 'product') return 'products';
    const st = String(item.service_type || '').toLowerCase();
    if (st.includes('supply')) return 'supply';
    if (st.includes('sand')) return 'sand_finish';
    return 'installation';
  }

  function groupItems(items) {
    const buckets = { installation: [], sand_finish: [], supply: [], products: [] };
    (items || []).forEach((it) => {
      const key = lineSection(it);
      if (buckets[key]) buckets[key].push(it);
    });
    return SECTION_DEFS.map((def) => ({ ...def, items: buckets[def.key] || [] })).filter(
      (s) => s.items.length
    );
  }

  function isApprovedStatus(status) {
    return ['approved', 'accepted'].includes(String(status || '').toLowerCase());
  }

  function createSignaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let hasStroke = false;
    ctx.strokeStyle = '#1a2036';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pointerPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const pt = e.touches ? e.touches[0] : e;
      return {
        x: (pt.clientX - rect.left) * scaleX,
        y: (pt.clientY - rect.top) * scaleY,
      };
    };

    const start = (e) => {
      drawing = true;
      hasStroke = true;
      const p = pointerPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      e.preventDefault();
    };

    const move = (e) => {
      if (!drawing) return;
      const p = pointerPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      e.preventDefault();
    };

    const end = () => {
      drawing = false;
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    return {
      clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasStroke = false;
      },
      isEmpty() {
        return !hasStroke;
      },
      renderFromName(name) {
        const ok = window.QuoteSignatureAuto?.renderAutoSignatureOnCanvas(canvas, name);
        hasStroke = !!ok;
        return ok;
      },
      toDataURL() {
        return canvas.toDataURL('image/png');
      },
    };
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  let signaturePad = null;

  function renderSignaturesBlock(q) {
    if (!isApprovedStatus(q.status)) return '';
    const clientName = escapeHtml(q.client_signed_name || q.customer_name || 'Client');
    const when = q.approved_at ? escapeHtml(String(q.approved_at).slice(0, 10)) : '—';
    const clientImg = q.client_signature_url
      ? `<img src="${access.apiBase}/client-signature" alt="Client signature" />`
      : '<span class="qp-muted-text">Signed</span>';
    return `
      <section class="qp-signatures">
        <div class="qp-signatures__col">
          <h3>Authorized by</h3>
          <div class="qp-signatures__box"><span class="qp-muted-text">Senior Floors</span></div>
        </div>
        <div class="qp-signatures__col">
          <h3>Client approval</h3>
          <div class="qp-signatures__box">${clientImg}</div>
          <p class="qp-signatures__name">${clientName}</p>
          <p class="qp-signatures__date">Date: ${when}</p>
        </div>
      </section>`;
  }

  function renderDocument(q, items) {
    const sections = groupItems(items);
    const subtotal = Number(q.subtotal) || 0;
    const discount =
      q.discount_type === 'percentage'
        ? (subtotal * (Number(q.discount_value) || 0)) / 100
        : Number(q.discount_value) || 0;
    const tax = Number(q.tax_total) || 0;
    const total = Number(q.total_amount) || 0;
    const terms = escapeHtml(q.terms_conditions || defaultTerms());
    const notes = q.notes ? escapeHtml(q.notes) : '';

    const sectionHtml = sections
      .map((sec) => {
        const rows = sec.items
          .map((it) => {
            const qty = Number(it.quantity) || 0;
            const rate = Number(it.rate) || 0;
            const amt = Math.round(qty * rate * 100) / 100;
            const desc = it.description ? `<div class="qp-line-desc">${escapeHtml(it.description)}</div>` : '';
            const note = it.notes ? `<div class="qp-line-note">${escapeHtml(it.notes)}</div>` : '';
            return `<tr>
              <td class="qp-line-name">${escapeHtml(it.name || '—')}${desc}${note}</td>
              <td class="qp-line-qty">${qty}</td>
              <td class="qp-line-rate">${money(rate)}</td>
              <td class="qp-line-amt">${money(amt)}</td>
            </tr>`;
          })
          .join('');
        return `<section class="qp-section">
          <h3 class="qp-section-title">${escapeHtml(sec.label)}</h3>
          <table class="qp-table"><tbody>${rows}</tbody></table>
        </section>`;
      })
      .join('');

    const exp = q.expiration_date ? String(q.expiration_date).slice(0, 10) : '—';
    const clientName = escapeHtml(q.customer_name || 'Client');

    return `
      <header class="qp-header">
        <div class="qp-brand">
          <h1 class="qp-brand__name">${escapeHtml(COMPANY.name)}</h1>
          <p class="qp-brand__tag">${escapeHtml(COMPANY.tagline)}</p>
          <p class="qp-brand__contact">${escapeHtml(COMPANY.phone)} · ${escapeHtml(COMPANY.email)}</p>
        </div>
        <div class="qp-quote-panel">
          <p class="qp-quote-panel__label">Quote</p>
          <p class="qp-quote-panel__number">${escapeHtml(q.quote_number || `Quote #${q.id}`)}</p>
          <p class="qp-quote-panel__client">${clientName}</p>
          <p class="qp-quote-panel__exp">Valid until ${escapeHtml(exp)}</p>
        </div>
      </header>

      ${sectionHtml}

      <div class="qp-totals">
        <div class="qp-totals__row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
        ${discount > 0 ? `<div class="qp-totals__row"><span>Discount</span><span>-${money(discount)}</span></div>` : ''}
        ${tax > 0 ? `<div class="qp-totals__row"><span>Tax</span><span>${money(tax)}</span></div>` : ''}
        <div class="qp-totals__row qp-totals__row--total"><span>Total</span><span>${money(total)}</span></div>
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

      ${renderSignaturesBlock(q)}
    `;
  }

  function openSignModal() {
    const modal = document.getElementById('qpSignModal');
    const canvas = document.getElementById('qpSignCanvas');
    if (!modal || !canvas) return;
    if (!signaturePad) signaturePad = createSignaturePad(canvas);
    signaturePad.clear();
    const nameInput = document.getElementById('qpSignerName');
    const defaultName = access?.lastQuote?.customer_name ? String(access.lastQuote.customer_name).trim() : '';
    if (nameInput) {
      nameInput.value = defaultName;
      if (defaultName.length >= 2) signaturePad.renderFromName(defaultName);
    }
    modal.classList.remove('hidden');
    nameInput?.focus();
  }

  function closeSignModal() {
    document.getElementById('qpSignModal')?.classList.add('hidden');
  }

  function wireSignModal() {
    document.getElementById('qpSignBackdrop')?.addEventListener('click', closeSignModal);
    document.getElementById('qpSignCancel')?.addEventListener('click', closeSignModal);
    document.getElementById('qpSignClear')?.addEventListener('click', () => signaturePad?.clear());
    const nameInput = document.getElementById('qpSignerName');
    if (nameInput) {
      nameInput.addEventListener(
        'input',
        debounce(() => {
          const n = nameInput.value.trim();
          if (!signaturePad) return;
          if (n.length >= 2) signaturePad.renderFromName(n);
          else signaturePad.clear();
        }, 250)
      );
    }
    document.getElementById('qpSignSubmit')?.addEventListener('click', async () => {
      const btn = document.getElementById('qpSignSubmit');
      const name = document.getElementById('qpSignerName')?.value?.trim() || '';
      if (!name || name.length < 2) {
        const msg = 'Please enter your full name.';
        if (typeof crmNotify === 'function') crmNotify(msg, 'error');
        else alert(msg);
        return;
      }
      if (!signaturePad) signaturePad = createSignaturePad(document.getElementById('qpSignCanvas'));
      if (signaturePad.isEmpty()) signaturePad.renderFromName(name);
      if (!signaturePad || signaturePad.isEmpty()) {
        const msg = 'Please draw your signature.';
        if (typeof crmNotify === 'function') crmNotify(msg, 'error');
        else alert(msg);
        return;
      }
      if (btn) btn.disabled = true;
      try {
        const rr = await fetch(`${access.apiBase}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signer_name: name,
            signature_png: signaturePad.toDataURL(),
          }),
        });
        const jj = await rr.json();
        if (rr.ok && jj.success) {
          closeSignModal();
          await load();
        } else {
          const msg = jj.error || 'Could not approve.';
          if (typeof crmNotify === 'function') crmNotify(msg, 'error');
          else alert(msg);
        }
      } catch {
        if (typeof crmNotify === 'function') crmNotify('Could not approve.', 'error');
        else alert('Could not approve.');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderActions(approved) {
    if (!access) return;
    if (approved) {
      actionsEl.innerHTML = '';
      actionsEl.hidden = true;
      const who = access?.lastQuote?.client_signed_name;
      approvedEl.textContent = who
        ? `Thank you — this quote is approved and signed by ${who}.`
        : 'Thank you — this quote is approved.';
      approvedEl.hidden = false;
      return;
    }
    approvedEl.hidden = true;
    actionsEl.hidden = false;
    actionsEl.innerHTML = `
      <a
        class="qp-btn qp-btn--outline"
        href="${access.apiBase}/pdf"
        target="_blank"
        rel="noopener noreferrer"
      >Download PDF</a>
      <button type="button" class="qp-btn qp-btn--primary" id="btnApprove">Approve &amp; sign</button>
    `;
    document.getElementById('btnApprove')?.addEventListener('click', openSignModal);
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
    if (!access) {
      showError('Invalid or missing link.');
      return;
    }
    try {
      const r = await fetch(access.apiBase);
      const j = await r.json();
      if (!r.ok || !j.success) {
        showError('Quote not found or link expired.');
        return;
      }
      const q = j.data.quote;
      const items = j.data.items || [];
      if (access) access.lastQuote = q;
      const approved = isApprovedStatus(q.status);

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

  wireSignModal();
  load();
})();
