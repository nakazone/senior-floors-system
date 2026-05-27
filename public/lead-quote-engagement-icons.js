/**
 * Ícones de estado do orçamento (e-mail enviado, link aberto, PDF) — Kanban e quick sheet.
 */
(function (global) {
  const SVG = {
    email:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    view:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    pdf:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  };

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '';
    }
  }

  function esc(text, escapeFn) {
    if (typeof escapeFn === 'function') return escapeFn(text);
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * @param {object|null} e — { quote_count, email_sent, email_sent_at, viewed, viewed_at, pdf_viewed, pdf_viewed_at }
   * @param {function} [escapeHtml]
   * @param {object} [opts] — { compact: boolean }
   */
  function renderLeadQuoteEngagementIconsHtml(e, escapeHtml, opts) {
    if (!e) return '';
    const count = Number(e.quote_count) || 0;
    const any =
      count > 0 || e.email_sent || e.viewed || e.pdf_viewed || e.email_sent_at || e.viewed_at || e.pdf_viewed_at;
    if (!any) return '';

    const compact = opts && opts.compact;
    const items = [
      {
        kind: 'email',
        on: !!(e.email_sent || e.email_sent_at),
        at: e.email_sent_at,
        labelOn: 'Orçamento enviado por e-mail',
        labelOff: 'E-mail do orçamento ainda não enviado',
      },
      {
        kind: 'view',
        on: !!(e.viewed || e.viewed_at),
        at: e.viewed_at,
        labelOn: 'Cliente abriu o link do orçamento',
        labelOff: 'Link do orçamento ainda não aberto',
      },
      {
        kind: 'pdf',
        on: !!(e.pdf_viewed || e.pdf_viewed_at),
        at: e.pdf_viewed_at,
        labelOn: 'Cliente descarregou o PDF',
        labelOff: 'PDF ainda não descarregado',
      },
    ];

    const icons = items
      .map((it) => {
        const when = it.on ? formatWhen(it.at) : '';
        const tip = (it.on ? it.labelOn : it.labelOff) + (when ? ` · ${when}` : '');
        return `<span class="lead-quote-icon lead-quote-icon--${it.kind}${it.on ? ' is-on' : ''}" title="${esc(tip, escapeHtml)}" aria-label="${esc(tip, escapeHtml)}">${SVG[it.kind]}<span class="lead-quote-icon__check" aria-hidden="true">?</span></span>`;
      })
      .join('');

    const cls = compact ? 'lead-quote-icons lead-quote-icons--compact' : 'lead-quote-icons';
    return `<div class="${cls}" role="group" aria-label="Estado do orçamento">${icons}</div>`;
  }

  /** Um único quote (quick sheet). */
  function engagementFromQuoteRow(q) {
    if (!q) return null;
    return {
      quote_count: 1,
      email_sent: !!q.email_sent_at,
      email_sent_at: q.email_sent_at || null,
      viewed: !!q.viewed_at,
      viewed_at: q.viewed_at || null,
      pdf_viewed: !!q.pdf_viewed_at,
      pdf_viewed_at: q.pdf_viewed_at || null,
    };
  }

  global.renderLeadQuoteEngagementIconsHtml = renderLeadQuoteEngagementIconsHtml;
  global.leadQuoteEngagementFromQuote = engagementFromQuoteRow;
})(typeof window !== 'undefined' ? window : globalThis);
