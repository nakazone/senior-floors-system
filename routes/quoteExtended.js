/**
 * Quote module v2 — full save, catalog, templates, PDF, email, duplicate, snapshots.
 */
import { getDBConnection } from '../config/db.js';
import * as business from '../modules/quotes/quoteBusiness.js';
import * as repo from '../modules/quotes/quoteRepository.js';

function mysqlText(e) {
  return String(e?.sqlMessage || e?.message || '');
}

/** Tabela ausente ou mensagem típica do MySQL (sqlMessage nem sempre repete o nome). */
function isMissingTableOrUnknown(e, nameFragment) {
  if (!e) return false;
  if (e.code === 'ER_NO_SUCH_TABLE') return nameFragment ? mysqlText(e).includes(nameFragment) : true;
  return nameFragment ? mysqlText(e).includes(nameFragment) : false;
}

export async function postQuoteCreateFull(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const created = await business.createQuoteFull(pool, req.body, req.session.userId);
    const ctx = await business.loadQuoteContext(pool, created.id);
    res.status(201).json({ success: true, data: ctx });
  } catch (e) {
    console.error('postQuoteCreateFull:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putQuoteSaveFull(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.saveQuoteFull(pool, id, req.body, req.session.userId, {
      snapshotPrevious: req.body.save_snapshot !== false,
    });
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    res.json({ success: true, data: ctx });
  } catch (e) {
    console.error('putQuoteSaveFull:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteDuplicate(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.duplicateQuote(pool, id, req.session.userId);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    res.status(201).json({ success: true, data: ctx });
  } catch (e) {
    console.error('postQuoteDuplicate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteGeneratePdf(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await business.generatePdfAndStore(pool, id);
    if (!r.ok) return res.status(404).json(r);
    res.json({
      success: true,
      invoice_pdf_url: `/api/quotes/${id}/invoice-pdf`,
    });
  } catch (e) {
    console.error('postQuoteGeneratePdf:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteSendEmail(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await business.mailQuote(pool, id, {
      to: req.body.to,
      subject: req.body.subject,
      html: req.body.html,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error, details: r.details });
    res.json({ success: true, resend_id: r.id });
  } catch (e) {
    console.error('postQuoteSendEmail:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteSnapshots(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    let rows = [];
    try {
      rows = await repo.listSnapshots(pool, id);
    } catch (err) {
      if (isMissingTableOrUnknown(err, 'quote_snapshots')) {
        return res.json({ success: true, data: [], message: 'Run migrate-quotes-module-complete.js' });
      }
      throw err;
    }
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('getQuoteSnapshots:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteCatalog(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const activeOnly = req.query.all !== '1';
    let rows;
    try {
      rows = await repo.listCatalog(pool, activeOnly);
    } catch (e) {
      if (isMissingTableOrUnknown(e, 'quote_service_catalog')) {
        return res.json({ success: true, data: [], message: 'Run migrate-quotes-module-complete.js' });
      }
      throw e;
    }
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('getQuoteCatalog:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

function normalizeCatalogBody(body) {
  const name = body.name != null ? String(body.name).trim() : '';
  const category = body.category != null ? String(body.category).trim() : '';
  if (!name) return { error: 'Nome do serviço é obrigatório.' };
  if (!category) return { error: 'Categoria é obrigatória.' };
  const defaultRate = parseFloat(String(body.default_rate ?? body.defaultRate ?? '').replace(',', '.'));
  if (!Number.isFinite(defaultRate) || defaultRate < 0) {
    return { error: 'Preço / taxa padrão inválido (use um número ≥ 0).' };
  }
  return {
    row: {
      name: name.slice(0, 255),
      category: category.slice(0, 64),
      default_rate: defaultRate,
      unit_type: body.unit_type || body.unitType || 'sq_ft',
      default_description:
        body.default_description != null
          ? String(body.default_description).trim().slice(0, 4000) || null
          : null,
      active: body.active !== false && body.active !== 0 && body.active !== '0',
    },
  };
}

export async function postQuoteCatalog(req, res) {
  try {
    const norm = normalizeCatalogBody(req.body);
    if (norm.error) {
      return res.status(400).json({ success: false, error: norm.error });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = await repo.insertCatalogItem(pool, norm.row);
    res.status(201).json({ success: true, data: { id } });
  } catch (e) {
    console.error('postQuoteCatalog:', e);
    if (isMissingTableOrUnknown(e, 'quote_service_catalog')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quotes-module (quote_service_catalog).',
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putQuoteCatalog(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const norm = normalizeCatalogBody(req.body);
    if (norm.error) {
      return res.status(400).json({ success: false, error: norm.error });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await repo.updateCatalogItem(pool, id, norm.row);
    res.json({ success: true });
  } catch (e) {
    console.error('putQuoteCatalog:', e);
    if (isMissingTableOrUnknown(e, 'quote_service_catalog')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quotes-module (quote_service_catalog).',
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteQuoteCatalog(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await repo.deleteCatalogItem(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteQuoteCatalog:', e);
    if (isMissingTableOrUnknown(e, 'quote_service_catalog')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quotes-module (quote_service_catalog).',
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteTemplates(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    let rows;
    try {
      rows = await repo.listTemplates(pool);
    } catch (e) {
      if (isMissingTableOrUnknown(e, 'quote_templates')) {
        return res.json({ success: true, data: [] });
      }
      throw e;
    }
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('getQuoteTemplates:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteTemplate(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    let tpl;
    try {
      tpl = await repo.getTemplateWithItems(pool, id);
    } catch (e) {
      if (isMissingTableOrUnknown(e, 'quote_template_items') || isMissingTableOrUnknown(e, 'quote_templates')) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      throw e;
    }
    if (!tpl) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: tpl });
  } catch (e) {
    console.error('getQuoteTemplate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteTemplate(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const tid = await repo.insertTemplate(pool, {
      name: req.body.name,
      service_type: req.body.service_type,
      created_by: req.session.userId,
      items: req.body.items,
    });
    const tpl = await repo.getTemplateWithItems(pool, tid);
    res.status(201).json({ success: true, data: tpl });
  } catch (e) {
    console.error('postQuoteTemplate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteQuoteTemplate(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await repo.deleteTemplate(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteQuoteTemplate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteFromTemplate(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const templateId = parseInt(req.body.template_id, 10);
    if (!templateId) return res.status(400).json({ success: false, error: 'template_id required' });
    const tpl = await repo.getTemplateWithItems(pool, templateId);
    if (!tpl) return res.status(404).json({ success: false, error: 'Template not found' });
    const items = (tpl.items || []).map((t) => ({
      description: t.description,
      quantity: t.quantity,
      rate: t.rate,
      unit_type: t.unit_type,
      notes: t.notes,
      service_catalog_id: t.service_catalog_id,
    }));
    const created = await business.createQuoteFull(
      pool,
      {
        customer_id: req.body.customer_id,
        lead_id: req.body.lead_id,
        service_type: tpl.service_type,
        items,
        status: 'draft',
        notes: req.body.notes,
        terms_conditions: req.body.terms_conditions,
      },
      req.session.userId
    );
    const ctx = await business.loadQuoteContext(pool, created.id);
    res.status(201).json({ success: true, data: ctx });
  } catch (e) {
    console.error('postQuoteFromTemplate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}
