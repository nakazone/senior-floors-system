/**
 * Google Apps Script — sincronizar planilha Meta → CRM (Railway)
 *
 * Instalação: na Google Sheet → Extensões → Apps Script → colar este ficheiro.
 * Depois: ⚙️ Definições do projeto → Propriedades do script → adicionar API_SYNC_SECRET
 *         (mesmo valor que SHEETS_SYNC_SECRET no Railway).
 *
 * Agendar: Acionadores → syncMetaLeadsToCrm → disparador temporal (ex.: a cada 5–15 min).
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

  var url = CONFIG.API_BASE.replace(/\/$/, '') + '/api/receive-lead';
  var synced = 0;
  var skipped = 0;
  var failed = 0;

  for (var r = CONFIG.HEADER_ROW; r < data.length; r++) {
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

    var options = {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: payload,
      headers: {
        'X-Sheets-Sync': '1',
        'X-Sheets-Sync-Secret': getApiSyncSecret_(),
      },
      muteHttpExceptions: true,
    };

    var res = UrlFetchApp.fetch(url, options);
    var code = res.getResponseCode();
    var body = res.getContentText() || '';

    if (code >= 200 && code < 300) {
      try {
        var j = JSON.parse(body);
        if (j.duplicate_skipped) {
          Logger.log('Linha ' + (r + 1) + ' duplicado → lead_id existente ' + j.lead_id);
        } else if (j.inserted_new === false) {
          Logger.log('Linha ' + (r + 1) + ' resposta OK sem insert novo: ' + body.slice(0, 200));
        }
      } catch (e) {
        /* corpo não JSON */
      }
      sheet.getRange(r + 1, col.synced + 1).setValue(new Date().toISOString());
      synced++;
    } else {
      Logger.log('Linha ' + (r + 1) + ' falha HTTP ' + code + ' ' + body.slice(0, 500));
      failed++;
    }
  }

  Logger.log('syncMetaLeadsToCrm: enviadas/marcadas ' + synced + ' | ignoradas ' + skipped + ' | falhas HTTP ' + failed);
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
