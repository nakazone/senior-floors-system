/**
 * Google Apps Script — sincronizar planilha Meta → CRM (Railway)
 *
 * Instalação: na Google Sheet → Extensões → Apps Script → colar este ficheiro.
 * Depois: ⚙️ Definições do projeto → Propriedades do script → adicionar API_SYNC_SECRET
 *         (mesmo valor que SHEETS_SYNC_SECRET no Railway).
 *
 * Agendar: Acionadores → syncMetaLeadsToCrm → disparador temporal (recomendado: 10–30 min).
 * Cada execução faz 1 UrlFetch para POST .../api/receive-lead-batch (vários leads no JSON).
 * Requer CRM atualizado com esse endpoint e SHEETS_SYNC_SECRET no Railway.
 * Quota Gmail ~20k UrlFetch/dia: com batch, 20k execuções ≈ até 20k × MAX_LEADS_PER_BATCH linhas.
 */

var CONFIG = {
  /** URL base do sistema no Railway (sem barra final) */
  API_BASE: 'https://senior-floors-system-production.up.railway.app',
  /**
   * Preferir: Apps Script → ⚙ Projeto → Propriedades do script → API_SYNC_SECRET
   * (mesmo valor que SHEETS_SYNC_SECRET no Railway). Fallback só para testes locais.
   */
  API_SYNC_SECRET: '',
  /** Nome exato da coluna que marca linha já enviada ao CRM (primeira linha) */
  SYNC_COLUMN_HEADER: 'CRM_Synced',
  /** form-name enviado ao CRM (backend usa source Meta-Instant) */
  FORM_NAME: 'meta-instant-form',
  /** Linha do cabeçalho (1 = primeira linha da folha) */
  HEADER_ROW: 1,
  /**
   * Máximo de linhas por execução (um único HTTP). Não pode exceder ~150–200 (limite no servidor).
   */
  MAX_LEADS_PER_BATCH: 150,
  /**
   * Opcional: nome EXATO do cabeçalho na planilha para o nome (minúsculas, como após trim).
   * Ex.: "full name"
   */
  NAME_COLUMN_HEADER: '',
};

function getApiSyncSecret_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('API_SYNC_SECRET');
  if (fromProps && String(fromProps).trim()) return String(fromProps).trim();
  if (CONFIG.API_SYNC_SECRET && String(CONFIG.API_SYNC_SECRET).trim()) return String(CONFIG.API_SYNC_SECRET).trim();
  throw new Error('Defina a propriedade do script API_SYNC_SECRET (ou CONFIG.API_SYNC_SECRET).');
}

/**
 * Meta: "p:+11234567890", "+1 303-555-0100", etc. → (303) 555-0100 (10 dígitos US).
 */
function formatUsPhoneForCrm_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^p:\s*/i, '');
  s = s.replace(/^tel:\s*/i, '');
  s = s.replace(/^whatsapp:\s*/i, '');
  var digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  return s.length > 50 ? s.slice(0, 50) : s;
}

function syncMetaLeadsToCrm() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    Logger.log('syncMetaLeadsToCrm: outra execução está a correr; ignorado para não duplicar UrlFetch.');
    return;
  }
  try {
    syncMetaLeadsToCrmBody_();
  } finally {
    lock.releaseLock();
  }
}

function syncMetaLeadsToCrmBody_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < CONFIG.HEADER_ROW + 1) return;

  var headers = data[CONFIG.HEADER_ROW - 1].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });

  var col = {
    name: resolveNameColumn_(headers),
    email: findCol(headers, [
      'email',
      'e-mail',
      'email address',
      'work_email',
      'work email',
      'contact_email',
      'contact email',
    ]),
    phone: findCol(headers, [
      'phone_number',
      'phone number',
      'phone',
      'mobile',
      'mobile phone',
      'telefone',
      'tel',
      'work_phone_number',
      'work phone number',
    ]),
    zip: findCol(headers, [
      'zip_code',
      'zip code',
      'zip',
      'postal code',
      'postcode',
      'postal_code',
      'cep',
    ]),
    service: findCol(headers, [
      'what_service_are_you_interested_in?',
      'what_service_are_you_interested_in',
      'what service are you interested in?',
      'what service are you interested in',
      'which service are you interested in?',
      'what_service_are_you_interested in',
    ]),
    synced: findCol(headers, [CONFIG.SYNC_COLUMN_HEADER.toLowerCase(), 'crm synced', 'synced']),
  };

  if (col.synced < 0) {
    throw new Error('Coluna "' + CONFIG.SYNC_COLUMN_HEADER + '" não encontrada. Adicione na primeira linha.');
  }
  if (col.name < 0 || col.email < 0 || col.phone < 0) {
    throw new Error(
      'Faltam colunas obrigatórias (name / email / phone). ZIP é opcional. Cabeçalhos: ' + headers.join(' | ')
    );
  }

  var batchUrl = CONFIG.API_BASE.replace(/\/$/, '') + '/api/receive-lead-batch';
  var maxLeads = Math.max(1, parseInt(CONFIG.MAX_LEADS_PER_BATCH, 10) || 150);
  var batchLeads = [];
  var batchRowR = [];
  var synced = 0;
  var skipped = 0;
  var failed = 0;

  for (var r = CONFIG.HEADER_ROW; r < data.length; r++) {
    if (batchLeads.length >= maxLeads) {
      Logger.log('syncMetaLeadsToCrm: lote máximo (' + maxLeads + '); resto na próxima execução.');
      break;
    }
    var row = data[r];
    var flag = String(row[col.synced] || '').trim().toLowerCase();
    if (flag === 'true' || flag === 'yes' || flag === '1' || flag === 'ok' || flag === 'synced') continue;

    var name = String(row[col.name] || '').trim();
    var email = String(row[col.email] || '').trim();
    var phone = formatUsPhoneForCrm_(String(row[col.phone] || '').trim());
    var zipRaw = col.zip >= 0 ? String(row[col.zip] || '').trim() : '';
    var service = col.service >= 0 ? String(row[col.service] || '').trim() : '';

    if (!name || !email || !phone) {
      Logger.log('Linha ' + (r + 1) + ' ignorada: falta name, email ou phone.');
      skipped++;
      continue;
    }

    var payload = {
      name: name,
      email: email,
      phone: phone,
      'form-name': CONFIG.FORM_NAME,
    };
    if (zipRaw) payload.zipcode = zipRaw;
    if (service) payload.message = service;

    batchLeads.push(payload);
    batchRowR.push(r);
  }

  if (batchLeads.length === 0) {
    Logger.log('syncMetaLeadsToCrm: nenhuma linha pendente.');
    return;
  }

  var jsonPayload = JSON.stringify({
    'form-name': CONFIG.FORM_NAME,
    leads: batchLeads,
  });
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: jsonPayload,
    headers: {
      'X-Sheets-Sync': '1',
      'X-Sheets-Sync-Secret': getApiSyncSecret_(),
    },
    muteHttpExceptions: true,
  };

  var res;
  try {
    res = UrlFetchApp.fetch(batchUrl, options);
  } catch (fetchErr) {
    var msg = String(fetchErr && fetchErr.message ? fetchErr.message : fetchErr);
    if (/urlfetch|too many times/i.test(msg)) {
      Logger.log(
        'Quota UrlFetch do Google esgotada (tenta amanhã) ou limite por minuto. Com batch já é só 1 pedido por execução — use intervalo maior no acionador ou Google Workspace.'
      );
    }
    throw fetchErr;
  }

  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    Logger.log('syncMetaLeadsToCrm: batch HTTP ' + code + ' ' + body.slice(0, 800));
    return;
  }

  var parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    Logger.log('syncMetaLeadsToCrm: resposta não JSON: ' + body.slice(0, 400));
    return;
  }
  if (!parsed.results || !parsed.results.length) {
    Logger.log('syncMetaLeadsToCrm: batch sem results');
    return;
  }

  for (var bi = 0; bi < parsed.results.length; bi++) {
    var item = parsed.results[bi];
    var idx = item.index;
    if (idx < 0 || idx >= batchRowR.length) continue;
    var rowIdx = batchRowR[idx];
    if (item.status >= 200 && item.status < 300 && item.success) {
      if (item.duplicate_skipped) {
        Logger.log('Linha ' + (rowIdx + 1) + ' duplicado → lead_id ' + item.lead_id);
      }
      sheet.getRange(rowIdx + 1, col.synced + 1).setValue(new Date().toISOString());
      synced++;
    } else {
      Logger.log('Linha ' + (rowIdx + 1) + ' falha status ' + item.status + ' ' + JSON.stringify(item).slice(0, 400));
      failed++;
    }
  }

  Logger.log('syncMetaLeadsToCrm: marcadas ' + synced + ' | falhas item ' + failed + ' | ignoradas ' + skipped);
}

function isLikelyServiceOrCampaignHeader_(h) {
  if (!h) return false;
  if (h.indexOf('[') !== -1 || h.indexOf(']') !== -1) return true;
  if (h.indexOf('reel') !== -1) return true;
  if (h.indexOf('which ') === 0 || h.indexOf('what service') !== -1 || h.indexOf('tipo de serviço') !== -1) return true;
  if (h.indexOf('campaign') !== -1 || h.indexOf('campanha') !== -1) return true;
  if (h.indexOf('ad set') !== -1 || h.indexOf('adset') !== -1) return true;
  if (h.indexOf('lead form') !== -1 || h.indexOf('form id') !== -1) return true;
  if (h.indexOf('service') !== -1 && h.indexOf('full') === -1 && h.indexOf('nome completo') === -1) return true;
  return false;
}

function resolveNameColumn_(headers) {
  var exactOverride = String(CONFIG.NAME_COLUMN_HEADER || '').trim().toLowerCase();
  if (exactOverride) {
    for (var o = 0; o < headers.length; o++) {
      if (headers[o] === exactOverride) return o;
    }
  }
  var direct = findCol(headers, [
    'full_name',
    'full name',
    'nome completo',
    'first and last name',
    'your full name',
    'contact name',
    'nome e sobrenome',
    'first name',
    'nome',
  ]);
  if (direct >= 0) return direct;
  return findNameColumnFallback_(headers);
}

function findNameColumnFallback_(headers) {
  var containsPrefer = ['full name', 'first and last', 'nome completo', 'contact name'];
  var i;
  var j;
  for (i = 0; i < containsPrefer.length; i++) {
    var w = containsPrefer[i].toLowerCase();
    for (j = 0; j < headers.length; j++) {
      if (headers[j].indexOf(w) !== -1 && !isLikelyServiceOrCampaignHeader_(headers[j])) return j;
    }
  }

  for (j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (isLikelyServiceOrCampaignHeader_(h)) continue;
    if (h === 'name' || h === 'nome') return j;
  }

  for (j = 0; j < headers.length; j++) {
    var h2 = headers[j];
    if (isLikelyServiceOrCampaignHeader_(h2)) continue;
    if (h2.indexOf('name') !== -1 && h2.indexOf('company') === -1 && h2.indexOf('business') === -1) return j;
  }

  return -1;
}

function findCol(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var want = candidates[i].toLowerCase();
    for (var j = 0; j < headers.length; j++) {
      if (headers[j] === want) return j;
    }
  }
  for (var c = 0; c < candidates.length; c++) {
    var w = candidates[c].toLowerCase();
    for (var k = 0; k < headers.length; k++) {
      if (headers[k].indexOf(w) !== -1) return k;
    }
  }
  return -1;
}
