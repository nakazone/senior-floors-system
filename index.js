/**
 * Senior Floors System — Node.js API for Railway
 * Receives leads from LP (Vercel), CRM APIs (leads list/get/update), db-check
 * Admin panel with authentication
 */
import 'dotenv/config';
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleReceiveLead, handleReceiveLeadBatch } from './routes/receiveLead.js';
import { handleDbCheck } from './routes/dbCheck.js';
import { listLeads, getLead, createLead, updateLead, deleteLead } from './routes/leads.js';
import { login, logout, checkSession, changePassword } from './routes/auth.js';
import { requireAuth, requireRole, requirePermission } from './middleware/auth.js';
import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  getCustomerByLead,
  createCustomerFromLead,
} from './routes/customers.js';
import {
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  deleteQuote,
  createQuoteFromInvoicePdf,
  streamQuoteInvoicePdf,
} from './routes/quotes.js';
import * as quoteExt from './routes/quoteExtended.js';
import { getEmailTransportStatus } from './modules/quotes/quoteMail.js';
import * as erpMaterials from './routes/erpMaterials.js';
import * as publicQuote from './routes/publicQuote.js';
import { quotePdfUploadMiddleware } from './lib/quotePdfUpload.js';
import { listProjects, getProject, createProject, updateProject } from './routes/projects.js';
import { listVisits, getVisit, createVisit, updateVisit } from './routes/visits.js';
import { listActivities, createActivity } from './routes/activities.js';
import { listContracts, getContract, createContract, updateContract } from './routes/contracts.js';
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getUserPermissions,
  updateUserPermissions,
} from './routes/users.js';
import { listPermissionRegistry } from './routes/permissions.js';
import { getDashboardStats } from './routes/dashboard.js';
import {
  getMarketingMetrics,
  listAdSpend,
  createAdSpend,
  updateAdSpend,
  deleteAdSpend,
  exportLeadsCsv,
  getLeadsNotContactedUrgent,
} from './routes/marketing.js';
import { getQualification, createOrUpdateQualification } from './routes/qualification.js';
import { listInteractions, createInteraction } from './routes/interactions.js';
import { getMeasurement, createOrUpdateMeasurement } from './routes/measurements.js';
import { listProposals, getProposal, createProposal, updateProposal } from './routes/proposals.js';
import { listFollowups, createFollowup, updateFollowup, deleteFollowup } from './routes/followups.js';
import { listPipelineStages } from './routes/pipelineStages.js';
import { listEstimates, getEstimate, createEstimate, updateEstimate, deleteEstimate, getEstimateAnalytics } from './routes/estimates.js';
import { listCrews, getCrew, createCrew, updateCrew } from './routes/crews.js';
import { listSchedules, getSchedule, createSchedule, updateSchedule, simulateScheduleOptions, getCrewAvailability } from './routes/schedules.js';
import {
  googleCalendarStatus,
  googleCalendarOAuthStart,
  googleCalendarOAuthCallback,
} from './routes/googleCalendarIntegration.js';
import { getProjectFinancial, updateProjectFinancial, listExpenses, createExpense, approveExpense, listPayrollEntries, createPayrollEntry, approvePayrollEntry, getFinancialDashboard } from './routes/financials.js';
import {
  getDBConnection,
  getMysqlConnectionTargetInfo,
  verifyMysqlPoolConnectivity,
  resetDbPool,
} from './config/db.js';
import { ensureQuoteInvoicePdfColumn } from './lib/ensureQuoteInvoicePdfColumn.js';
import { ensureUserModuleColumns } from './lib/ensureUserModuleColumns.js';
import { ensureCustomersResponsibleNameColumn } from './lib/ensureCustomersResponsibleNameColumn.js';
import { getUiConfig } from './routes/uiConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const rawPort = process.env.PORT;
const PORT =
  rawPort !== undefined && rawPort !== null && String(rawPort).trim() !== ''
    ? parseInt(String(rawPort), 10)
    : 3000;
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error('[boot] PORT inválido:', rawPort);
  process.exit(1);
}

// res.json não serializa BigInt (quebra APIs/sessão se algum campo escapar)
app.set('json replacer', (_, value) => (typeof value === 'bigint' ? value.toString() : value));

// Railway / reverse proxy — necessário para cookie Secure e req.secure corretos
app.set('trust proxy', 1);

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
// UI em outro domínio (ex.: Vercel) chamando API no Railway: defina SESSION_CROSS_SITE=1 (cookie SameSite=None; Secure)
const crossSiteSession = process.env.SESSION_CROSS_SITE === '1' || process.env.SESSION_CROSS_SITE === 'true';

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'senior-floors-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'seniorfloors.sid', // Nome customizado para evitar conflitos
  rolling: true,
  cookie: {
    secure: crossSiteSession || isProduction,
    httpOnly: true,
    sameSite: crossSiteSession ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Requested-With', 'X-Sheets-Sync', 'X-Sheets-Sync-Secret'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ficheiros HTML/JS sem cache agressivo (evita CRM antigo após deploy)
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      const lower = String(filePath).toLowerCase();
      if (lower.endsWith('.html') || lower.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
      }
    },
  })
);

// Root route - redirect to admin or show API info
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard.html');
  }
  res.redirect('/login.html');
});

// Authentication routes (public)
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/session', checkSession);
app.post('/api/auth/change-password', requireAuth, changePassword);

// Public API routes (LP can call these)
app.get('/api/db-check', handleDbCheck);
app.post('/api/receive-lead', handleReceiveLead);
app.post('/api/receive-lead-batch', handleReceiveLeadBatch);
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'senior-floors-system', time: new Date().toISOString() });
});

/** Ligação real ao MySQL (diagnóstico Railway). Sem credenciais na resposta. */
app.get('/api/health/email', (req, res) => {
  res.json({ ok: true, ...getEmailTransportStatus(), time: new Date().toISOString() });
});

app.get('/api/health/db', async (req, res) => {
  const target = getMysqlConnectionTargetInfo();
  const body = {
    ok: false,
    configured: target.configured,
    host: target.host,
    port: target.port,
    database: target.database,
    error_code: null,
    message: null,
  };
  try {
    if (!target.configured) {
      body.message = 'MySQL não configurado (sem DATABASE_URL / DB_* / MYSQL* válidos).';
      return res.status(503).json(body);
    }
    const pool = await getDBConnection();
    if (!pool) {
      body.message = 'Pool não disponível.';
      return res.status(503).json(body);
    }
    await pool.query('SELECT 1');
    body.ok = true;
    body.message = 'MySQL respondeu.';
    res.json(body);
  } catch (e) {
    body.error_code = e.code || null;
    body.message = e.message || String(e);
    res.status(503).json(body);
  }
});

// Public quote (token link — no auth)
app.get('/api/public/quotes/:token', publicQuote.getPublicQuote);
app.post('/api/public/quotes/:token/approve', publicQuote.postApproveQuote);

// Protected API routes (require authentication)

// Dashboard
app.get('/api/dashboard/stats', requireAuth, getDashboardStats);

// Marketing analytics
app.get('/api/marketing/metrics', requireAuth, getMarketingMetrics);
app.get('/api/marketing/ad-spend', requireAuth, listAdSpend);
app.post('/api/marketing/ad-spend', requireAuth, createAdSpend);
app.put('/api/marketing/ad-spend/:id', requireAuth, updateAdSpend);
app.delete('/api/marketing/ad-spend/:id', requireAuth, deleteAdSpend);
app.get('/api/marketing/export/leads', requireAuth, exportLeadsCsv);
app.get('/api/marketing/alerts/not-contacted', requireAuth, getLeadsNotContactedUrgent);

// Pipeline Stages
app.get('/api/pipeline-stages', requireAuth, listPipelineStages);

// Leads (rotas com subpath primeiro, depois :id)
app.get('/api/leads', requireAuth, listLeads);
app.get('/api/leads/:leadId/qualification', requireAuth, getQualification);
app.post('/api/leads/:leadId/qualification', requireAuth, createOrUpdateQualification);
app.put('/api/leads/:leadId/qualification', requireAuth, createOrUpdateQualification);
app.get('/api/leads/:leadId/interactions', requireAuth, listInteractions);
app.post('/api/leads/:leadId/interactions', requireAuth, createInteraction);
app.get('/api/leads/:leadId/followups', requireAuth, listFollowups);
app.post('/api/leads/:leadId/followups', requireAuth, createFollowup);
app.get('/api/leads/:leadId/proposals', requireAuth, listProposals);
app.post('/api/leads/:leadId/proposals', requireAuth, createProposal);
app.get('/api/leads/:id', requireAuth, getLead);
app.post('/api/leads', requireAuth, createLead);
app.put('/api/leads/:id', requireAuth, updateLead);
app.delete('/api/leads/:id', requireAuth, deleteLead);

// Follow-ups (por ID de follow-up)
app.put('/api/followups/:followupId', requireAuth, updateFollowup);
app.delete('/api/followups/:followupId', requireAuth, deleteFollowup);

// Proposals
app.get('/api/proposals/:proposalId', requireAuth, getProposal);
app.put('/api/proposals/:proposalId', requireAuth, updateProposal);

// Customers
app.get('/api/customers/by-lead/:leadId', requireAuth, getCustomerByLead);
app.post('/api/customers/from-lead', requireAuth, requirePermission('customers.create'), createCustomerFromLead);
app.get('/api/customers', requireAuth, listCustomers);
app.get('/api/customers/:id', requireAuth, getCustomer);
app.post('/api/customers', requireAuth, requirePermission('customers.create'), createCustomer);
app.put('/api/customers/:id', requireAuth, requirePermission('customers.edit'), updateCustomer);

// Quotes (rotas específicas antes de :id)
app.get('/api/quotes', requireAuth, listQuotes);
app.post('/api/quotes/import-invoice-pdf', requireAuth, quotePdfUploadMiddleware, createQuoteFromInvoicePdf);
app.post('/api/quotes/full', requireAuth, requirePermission('quotes.create'), quoteExt.postQuoteCreateFull);
app.post('/api/quotes/from-template', requireAuth, requirePermission('quotes.create'), quoteExt.postQuoteFromTemplate);
app.get('/api/quote-catalog', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteCatalog);
app.post('/api/quote-catalog', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteCatalog);
app.put('/api/quote-catalog/:id', requireAuth, requirePermission('quotes.edit'), quoteExt.putQuoteCatalog);
app.delete('/api/quote-catalog/:id', requireAuth, requirePermission('quotes.edit'), quoteExt.deleteQuoteCatalog);
app.get('/api/quote-templates', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteTemplates);
app.get('/api/quote-templates/:id', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteTemplate);
app.post('/api/quote-templates', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteTemplate);
app.delete('/api/quote-templates/:id', requireAuth, requirePermission('quotes.edit'), quoteExt.deleteQuoteTemplate);

app.get('/api/config/ui', requireAuth, getUiConfig);
app.get('/api/erp/category-margins', requireAuth, requirePermission('quotes.view'), erpMaterials.getCategoryMargins);
app.put('/api/erp/category-margins', requireAuth, requirePermission('quotes.edit'), erpMaterials.putCategoryMargin);
app.get('/api/erp/suppliers', requireAuth, requirePermission('quotes.view'), erpMaterials.listSuppliersApi);
app.post('/api/erp/suppliers', requireAuth, requirePermission('quotes.edit'), erpMaterials.postSupplier);
app.put('/api/erp/suppliers/:id', requireAuth, requirePermission('quotes.edit'), erpMaterials.putSupplier);
app.delete('/api/erp/suppliers/:id', requireAuth, requirePermission('quotes.edit'), erpMaterials.deleteSupplier);
app.get('/api/erp/products/preview/:id', requireAuth, requirePermission('quotes.view'), erpMaterials.getProductPricingPreview);
app.get('/api/erp/products', requireAuth, requirePermission('quotes.view'), erpMaterials.listProductsApi);
app.post('/api/erp/products', requireAuth, requirePermission('quotes.edit'), erpMaterials.postProduct);
app.put('/api/erp/products/:id', requireAuth, requirePermission('quotes.edit'), erpMaterials.putProduct);
app.delete('/api/erp/products/:id', requireAuth, requirePermission('quotes.edit'), erpMaterials.deleteProduct);
app.get('/api/quotes/:id/invoice-pdf', requireAuth, streamQuoteInvoicePdf);
app.put('/api/quotes/:id/full', requireAuth, requirePermission('quotes.edit'), quoteExt.putQuoteSaveFull);
app.post('/api/quotes/:id/duplicate', requireAuth, requirePermission('quotes.create'), quoteExt.postQuoteDuplicate);
app.post('/api/quotes/:id/generate-pdf', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteGeneratePdf);
app.post('/api/quotes/:id/send-email', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteSendEmail);
app.get('/api/quotes/:id/snapshots', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteSnapshots);
app.get('/api/quotes/:id', requireAuth, getQuote);
app.post('/api/quotes', requireAuth, createQuote);
app.put('/api/quotes/:id', requireAuth, updateQuote);
app.delete('/api/quotes/:id', requireAuth, deleteQuote);

// Estimates (Professional Flooring Estimate Engine)
app.get('/api/estimates', requireAuth, listEstimates);
app.get('/api/estimates/:id', requireAuth, getEstimate);
app.post('/api/estimates', requireAuth, createEstimate);
app.put('/api/estimates/:id', requireAuth, updateEstimate);
app.delete('/api/estimates/:id', requireAuth, deleteEstimate);
app.get('/api/estimates/analytics/overview', requireAuth, getEstimateAnalytics);

// Projects
app.get('/api/projects', requireAuth, listProjects);
app.get('/api/projects/:id', requireAuth, getProject);
app.post('/api/projects', requireAuth, createProject);
app.put('/api/projects/:id', requireAuth, updateProject);

// Visits/Schedule
app.get('/api/visits', requireAuth, listVisits);
app.get('/api/visits/:id', requireAuth, getVisit);
app.post('/api/visits', requireAuth, createVisit);
app.put('/api/visits/:id', requireAuth, updateVisit);

// Crews
app.get('/api/crews', requireAuth, listCrews);
app.get('/api/crews/:id', requireAuth, getCrew);
app.post('/api/crews', requireAuth, createCrew);
app.put('/api/crews/:id', requireAuth, updateCrew);

// Google Calendar (CRM → Google)
app.get('/api/integrations/google-calendar/status', requireAuth, googleCalendarStatus);
app.get('/api/integrations/google-calendar/oauth-url', requireAuth, requireRole('admin'), googleCalendarOAuthStart);
app.get('/api/integrations/google-calendar/callback', googleCalendarOAuthCallback);

// Project Schedules (Smart Scheduling)
app.get('/api/schedules', requireAuth, listSchedules);
app.get('/api/schedules/:id', requireAuth, getSchedule);
app.post('/api/schedules', requireAuth, createSchedule);
app.put('/api/schedules/:id', requireAuth, updateSchedule);
app.post('/api/schedules/simulate', requireAuth, simulateScheduleOptions);
app.get('/api/crews/:crewId/availability', requireAuth, getCrewAvailability);

// Measurements (from visits)
app.get('/api/visits/:visitId/measurement', requireAuth, getMeasurement);
app.post('/api/visits/:visitId/measurement', requireAuth, createOrUpdateMeasurement);
app.put('/api/visits/:visitId/measurement', requireAuth, createOrUpdateMeasurement);

// Activities
app.get('/api/activities', requireAuth, listActivities);
app.post('/api/activities', requireAuth, createActivity);

// Contracts/Financeiro
app.get('/api/contracts', requireAuth, listContracts);
app.get('/api/contracts/:id', requireAuth, getContract);
app.post('/api/contracts', requireAuth, createContract);
app.put('/api/contracts/:id', requireAuth, updateContract);

// Financial Management
app.get('/api/projects/:projectId/financial', requireAuth, getProjectFinancial);
app.put('/api/projects/:projectId/financial', requireAuth, updateProjectFinancial);
app.get('/api/expenses', requireAuth, listExpenses);
app.post('/api/expenses', requireAuth, createExpense);
app.put('/api/expenses/:id/approve', requireAuth, approveExpense);
app.get('/api/payroll', requireAuth, listPayrollEntries);
app.post('/api/payroll', requireAuth, createPayrollEntry);
app.put('/api/payroll/:id/approve', requireAuth, approvePayrollEntry);
app.get('/api/financial/dashboard', requireAuth, getFinancialDashboard);

// Permissions (matriz de módulos)
app.get('/api/permissions', requireAuth, requirePermission('users.view'), listPermissionRegistry);

// Users (subpaths antes de :id)
app.get('/api/users/:id/permissions', requireAuth, requirePermission('users.view'), getUserPermissions);
app.put(
  '/api/users/:id/permissions',
  requireAuth,
  requirePermission('users.manage_permissions'),
  updateUserPermissions
);
app.get('/api/users', requireAuth, requirePermission('users.view'), listUsers);
app.get('/api/users/:id', requireAuth, requirePermission('users.view'), getUser);
app.post('/api/users', requireAuth, requirePermission('users.create'), createUser);
app.put('/api/users/:id', requireAuth, requirePermission('users.edit'), updateUser);
app.delete('/api/users/:id', requireAuth, requirePermission('users.delete'), deleteUser);

// Compatibility: system.php?api=receive-lead
app.all('/system.php', (req, res) => {
  if (req.query.api === 'receive-lead' && req.method === 'POST') return handleReceiveLead(req, res);
  if (req.query.api === 'db-check' && req.method === 'GET') return handleDbCheck(req, res);
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware (express-async-errors envia rejeições async para aqui)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  console.error('Stack:', err.stack);
  const c = err && err.code;
  const transientDb =
    c === 'ECONNREFUSED' ||
    c === 'ETIMEDOUT' ||
    c === 'PROTOCOL_CONNECTION_LOST' ||
    c === 'ECONNRESET' ||
    c === 'EPIPE' ||
    (err && err.fatal === true);
  if (transientDb) {
    resetDbPool().catch(() => {});
  }
  const showDetail =
    process.env.NODE_ENV === 'development' || process.env.API_ERROR_DETAIL === '1';
  const status = transientDb ? 503 : 500;
  res.status(status).json({
    success: false,
    error: transientDb ? 'Database temporarily unavailable' : 'Internal server error',
    code: c || undefined,
    message: showDetail ? (err && err.message) : undefined,
  });
});

// 404 handler (rotas /api/* desconhecidas — ver path/method na resposta)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({
      success: false,
      error: 'Not found',
      path: req.path,
      method: req.method,
      hint:
        'Confirme o URL (ex.: POST /api/quotes/:id/send-email, GET /api/health/email). Deploy recente inclui /api/health/email.',
    });
  } else {
    res.status(404).send('Page not found');
  }
});

async function start() {
  const pool = await getDBConnection();
  const skipMysqlPing =
    process.env.SKIP_MYSQL_PING === '1' || process.env.SKIP_MYSQL_PING === 'true';

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Senior Floors System running on port ${PORT}`);
    console.log('  Admin Panel: http://localhost:' + PORT);
    console.log('\n  API Endpoints:');
    console.log('  Dashboard: GET /api/dashboard/stats');
    console.log('  Leads: GET /api/leads, GET /api/leads/:id, PUT /api/leads/:id, DELETE /api/leads/:id');
    console.log('  Customers: GET /api/customers, POST /api/customers, PUT /api/customers/:id');
    console.log('  Quotes: GET /api/quotes, POST /api/quotes, PUT /api/quotes/:id');
    console.log('  Projects: GET /api/projects, POST /api/projects, PUT /api/projects/:id');
    console.log('  Visits: GET /api/visits, POST /api/visits, PUT /api/visits/:id');
    console.log('  Activities: GET /api/activities, POST /api/activities');
    console.log('  Contracts: GET /api/contracts, POST /api/contracts, PUT /api/contracts/:id');
    console.log('  Users: GET/POST/PUT/DELETE /api/users, permissões, change-password');

    (async () => {
      if (!pool) {
        console.error(
          '[db] AVISO: sem pool MySQL — no serviço Node defina DATABASE_URL (referência ao MySQL). Diagnóstico: GET /api/health/db'
        );
        return;
      }
      if (!skipMysqlPing) {
        const ping = await verifyMysqlPoolConnectivity(pool);
        if (!ping.ok) {
          const t = getMysqlConnectionTargetInfo();
          const err = ping.error;
          console.error(
            '[db] AVISO: MySQL inacessível em',
            `${t.host}:${t.port}`,
            '—',
            err?.code || err?.message
          );
          console.error(
            '[db] Corrija DATABASE_URL no Node (mesmo projeto que o MySQL). Rotas que usam BD respondem 503 até lá.'
          );
        } else {
          console.log('[db] MySQL OK (ping).');
        }
      }
      await ensureQuoteInvoicePdfColumn(pool);
      await ensureUserModuleColumns(pool);
      await ensureCustomersResponsibleNameColumn(pool);
    })().catch((e) => console.error('[db] Arranque pós-listen:', e));
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection', reason);
});
