/**
 * Canonical English labels for pipeline columns (by slug).
 * Used when DB `pipeline_stages.name` differs or legacy `leads.status` values exist.
 */
(function (global) {
  /** Kanban v3 order — always show these in dropdowns even if DB only has legacy rows. */
  const PIPELINE_V9_SLUGS = [
    'new_lead',
    'contacted',
    'meeting_scheduled',
    'quote_sent',
    'follow_up_1',
    'follow_up_2',
    'closing_attempt',
    'won',
    'lost',
  ];

  const LEGACY_SLUG_TO_CANONICAL = {
    lead_received: 'new_lead',
    new: 'new_lead',
    contact_made: 'contacted',
    qualified: 'contacted',
    visit_scheduled: 'meeting_scheduled',
    measurement_done: 'follow_up_1',
    proposal_created: 'quote_sent',
    proposal_sent: 'quote_sent',
    negotiation: 'closing_attempt',
    closed_won: 'won',
    closed_lost: 'lost',
    production: 'won',
  };

  const PIPELINE_STAGE_LABELS_EN = {
    new_lead: 'New Lead',
    contacted: 'Contacted',
    meeting_scheduled: 'Meeting Scheduled',
    quote_sent: 'Quote Sent',
    follow_up_1: 'Follow Up 1',
    follow_up_2: 'Follow Up 2',
    closing_attempt: 'Closing Attempt',
    won: 'Won',
    lost: 'Lost',
    lead_received: 'New Lead',
    new: 'New Lead',
    contact_made: 'Contacted',
    qualified: 'Contacted',
    visit_scheduled: 'Meeting Scheduled',
    measurement_done: 'Follow Up 1',
    proposal_created: 'Quote Sent',
    proposal_sent: 'Quote Sent',
    negotiation: 'Closing Attempt',
    closed_won: 'Won',
    closed_lost: 'Lost',
    production: 'Won',
  };

  const V9_SET = new Set(PIPELINE_V9_SLUGS);

  function normalizePipelineSlug(slug) {
    const s = String(slug || '').trim();
    return LEGACY_SLUG_TO_CANONICAL[s] || s;
  }

  /**
   * Merge API `pipeline_stages` rows with the 9 canonical slugs.
   * Fills gaps (e.g. missing follow_up_1 in DB) so dropdowns always match the Kanban.
   * @param {Array<object>} apiRows
   * @returns {Array<{ id?: number, slug: string, name?: string|null, order_num: number }>}
   */
  function mergePipelineStagesForUi(apiRows) {
    const rows = Array.isArray(apiRows) ? apiRows : [];
    const active = rows.filter((s) => {
      if (!s || s.slug == null) return false;
      const ia = s.is_active;
      if (ia === 0 || ia === '0' || ia === false) return false;
      return true;
    });

    const byCanon = new Map();
    for (const s of active) {
      const raw = String(s.slug || '').trim();
      const canon = normalizePipelineSlug(raw);
      if (!V9_SET.has(canon)) continue;
      const cur = byCanon.get(canon);
      if (!cur) {
        byCanon.set(canon, { ...s, slug: canon });
      } else if (raw === canon) {
        byCanon.set(canon, { ...s, slug: canon });
      }
    }

    return PIPELINE_V9_SLUGS.map((slug, i) => {
      const row = byCanon.get(slug);
      if (row) {
        return {
          id: row.id,
          slug,
          name: row.name,
          order_num: row.order_num != null ? row.order_num : i + 1,
        };
      }
      return { slug, name: null, order_num: i + 1 };
    });
  }

  /**
   * @param {string} [slug]
   * @param {string} [nameFallback] — name from API (`pipeline_stages.name`)
   * @returns {string}
   */
  function pipelineStageDisplayName(slug, nameFallback) {
    const s = (slug || '').trim();
    if (s && Object.prototype.hasOwnProperty.call(PIPELINE_STAGE_LABELS_EN, s)) {
      return PIPELINE_STAGE_LABELS_EN[s];
    }
    return nameFallback || s || '';
  }

  global.PIPELINE_V9_SLUGS = PIPELINE_V9_SLUGS;
  global.normalizePipelineSlug = normalizePipelineSlug;
  global.mergePipelineStagesForUi = mergePipelineStagesForUi;
  global.PIPELINE_STAGE_LABELS_EN = PIPELINE_STAGE_LABELS_EN;
  /** @deprecated use PIPELINE_STAGE_LABELS_EN */
  global.PIPELINE_STAGE_LABELS_PT = PIPELINE_STAGE_LABELS_EN;
  global.pipelineStageDisplayName = pipelineStageDisplayName;
})(typeof window !== 'undefined' ? window : globalThis);
