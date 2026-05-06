/**
 * Rótulos em português para colunas/select do pipeline (por slug).
 * Usado no Kanban e na ficha do lead; o banco pode ainda ter nomes antigos ou em inglês.
 */
(function (global) {
  const PIPELINE_STAGE_LABELS_PT = {
    // Pipeline Kanban v3
    new_lead: 'Novo lead',
    contacted: 'Contato realizado',
    meeting_scheduled: 'Reunião agendada',
    quote_sent: 'Orçamento enviado',
    follow_up_1: 'Follow-up 1',
    follow_up_2: 'Follow-up 2',
    closing_attempt: 'Tentativa de fechamento',
    won: 'Ganho',
    lost: 'Perdido',
    // Slugs legados (pré-migração v3)
    lead_received: 'Novo lead',
    new: 'Novo lead',
    contact_made: 'Contato realizado',
    qualified: 'Qualificado',
    visit_scheduled: 'Visita agendada',
    measurement_done: 'Medição realizada',
    proposal_created: 'Proposta criada',
    proposal_sent: 'Proposta enviada',
    negotiation: 'Em negociação',
    closed_won: 'Ganho',
    closed_lost: 'Perdido',
    production: 'Produção / obra',
  };

  /**
   * @param {string} [slug]
   * @param {string} [nameFallback] — nome vindo da API
   * @returns {string}
   */
  function pipelineStageDisplayName(slug, nameFallback) {
    const s = (slug || '').trim();
    if (s && Object.prototype.hasOwnProperty.call(PIPELINE_STAGE_LABELS_PT, s)) {
      return PIPELINE_STAGE_LABELS_PT[s];
    }
    return nameFallback || s || '';
  }

  global.PIPELINE_STAGE_LABELS_PT = PIPELINE_STAGE_LABELS_PT;
  global.pipelineStageDisplayName = pipelineStageDisplayName;
})(typeof window !== 'undefined' ? window : globalThis);
