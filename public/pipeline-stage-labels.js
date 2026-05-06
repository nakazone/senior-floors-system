/**
 * Canonical English labels for pipeline columns (by slug).
 * Used when DB `pipeline_stages.name` differs or legacy `leads.status` values exist.
 */
(function (global) {
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
    // Legacy slugs ? same column titles as above after migration
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

  global.PIPELINE_STAGE_LABELS_EN = PIPELINE_STAGE_LABELS_EN;
  /** @deprecated use PIPELINE_STAGE_LABELS_EN */
  global.PIPELINE_STAGE_LABELS_PT = PIPELINE_STAGE_LABELS_EN;
  global.pipelineStageDisplayName = pipelineStageDisplayName;
})(typeof window !== 'undefined' ? window : globalThis);
