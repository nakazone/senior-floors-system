(function () {
  const PIPELINE = [
    { key: 'pending', label: 'Submitted' },
    { key: 'reviewing', label: 'Under review' },
    { key: 'quoted', label: 'Quote sent' },
    { key: 'won', label: 'Accepted' },
    { key: 'lost', label: 'Declined' },
  ];

  const STATUS_LABELS = {
    pending: 'Submitted',
    reviewing: 'Under review',
    in_review: 'Under review',
    quoted: 'Quote sent',
    won: 'Accepted',
    lost: 'Declined',
    closed: 'Declined',
    new_lead: 'Received',
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizeStatus(s) {
    const k = String(s || 'pending').toLowerCase();
    if (k === 'in_review') return 'reviewing';
    if (k === 'closed') return 'lost';
    return k;
  }

  function statusLabel(s) {
    const n = normalizeStatus(s);
    return STATUS_LABELS[n] || STATUS_LABELS[s] || s || '—';
  }

  function renderStatusPipeline(current) {
    const cur = normalizeStatus(current);
    const terminal = cur === 'won' || cur === 'lost';
    const curIdx = PIPELINE.findIndex((p) => p.key === cur);
    return `<div class="bp-ref-status-pipeline" aria-label="Status progression">${PIPELINE.map((p, i) => {
      let cls = '';
      if (terminal && p.key === cur) cls = 'is-current';
      else if (!terminal && curIdx >= 0 && i <= curIdx) cls = i === curIdx ? 'is-current' : 'is-done';
      else if (!terminal && curIdx < 0 && p.key === 'pending') cls = 'is-current';
      return `<span class="${cls}">${escapeHtml(p.label)}</span>`;
    }).join('')}</div>`;
  }

  function renderTimeline(events) {
    if (!events || !events.length) return '<p class="bp-muted" style="font-size:12px;margin:8px 0 0">No status history yet.</p>';
    return `<ul class="bp-ref-timeline">${events
      .map(
        (e) =>
          `<li><span class="bp-ref-timeline__status">${escapeHtml(statusLabel(e.status))}</span>
            <span class="bp-muted">${escapeHtml(String(e.created_at || '').slice(0, 16).replace('T', ' '))}</span>
            ${e.note ? `<span>${escapeHtml(e.note)}</span>` : ''}</li>`
      )
      .join('')}</ul>`;
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-referrals');
    const j = await r.json();
    const host = document.getElementById('refList');
    const items = j.data || [];
    const sum = j.summary || {};

    const summary = document.getElementById('refSummary');
    if (summary) {
      summary.innerHTML = `
        <div class="bp-metrics">
          <div class="bp-card bp-metric"><div class="bp-metric__val">${sum.submitted ?? items.length}</div><div class="bp-metric__lbl">Submitted</div></div>
          <div class="bp-card bp-metric"><div class="bp-metric__val">${sum.converted ?? 0}</div><div class="bp-metric__lbl">Quote sent / accepted</div></div>
          <div class="bp-card bp-metric"><div class="bp-metric__val">$${sum.commission_accrued ?? 0}</div><div class="bp-metric__lbl">Commission (when active)</div></div>
        </div>
        ${sum.note ? `<p class="bp-muted" style="font-size:12px">${escapeHtml(sum.note)}</p>` : ''}`;
    }

    if (!items.length) {
      host.innerHTML =
        '<p class="bp-card">No referrals yet. <a href="builder-estimate-request.html">Submit an estimate request</a> to get started.</p>';
      return;
    }

    host.innerHTML = items
      .map((it, idx) => {
        const ref = it.ref_number || it.title || `#${it.id}`;
        const events = it.events || [];
        const st = normalizeStatus(it.status);
        const typeLabel = it.type === 'estimate' ? 'Estimate request' : 'Lead referral';
        return `<div class="bp-card bp-ref-row">
          <button type="button" class="bp-ref-toggle" data-idx="${idx}" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;padding:0">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:flex-start">
              <div>
                <strong>${escapeHtml(ref)}</strong>
                <span class="bp-muted" style="font-size:11px;display:block;margin-top:2px">${escapeHtml(typeLabel)}</span>
              </div>
              <span class="bp-badge bp-badge--${st === 'won' ? 'active' : st === 'lost' ? 'inactive' : 'pending'}">${escapeHtml(statusLabel(it.status))}</span>
            </div>
            <p class="bp-muted" style="margin:4px 0;font-size:13px">${escapeHtml(it.address || '—')} · ${escapeHtml(String(it.created_at || '').slice(0, 10))}${it.area_sqft ? ` · ${it.area_sqft} sqft` : ''}</p>
            ${it.type === 'estimate' ? renderStatusPipeline(it.status) : ''}
          </button>
          <div class="bp-ref-detail hidden" id="refDetail${idx}">
            <p class="bp-muted" style="font-size:12px;margin:8px 0 4px"><strong>Status history</strong></p>
            ${renderTimeline(events)}
          </div>
        </div>`;
      })
      .join('');

    host.querySelectorAll('.bp-ref-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(`refDetail${btn.dataset.idx}`);
        el?.classList.toggle('hidden');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const boot = window.builderPortalCommon?.whenPortalReady;
    if (typeof boot === 'function') {
      boot().then((ok) => {
        if (ok) load().catch(console.error);
      });
    } else if (window.builderAuth?.getToken()) {
      load().catch(console.error);
    }
  });
})();
