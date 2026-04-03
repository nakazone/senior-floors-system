# Senior Floors System (Node.js)

API do Sistema CRM para **Railway**. Recebe leads da LP (Vercel) e expõe endpoints para listar/editar leads.

## Repositório

- **Git:** https://github.com/nakazone/senior-floors-system
- **Deploy:** Railway (conecte este repo no dashboard)

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/receive-lead` | Recebe lead da LP (Vercel envia aqui) |
| GET | `/api/db-check` | Status do banco (para a LP verificar) |
| GET | `/api/leads` | Lista leads (query: `page`, `limit`) |
| GET | `/api/leads/:id` | Detalhe do lead |
| PUT | `/api/leads/:id` | Atualiza lead (status, priority, etc.) |
| GET | `/api/health` | Health check |

## Configuração (Railway)

1. **New Project** → **Deploy from GitHub** → escolha `nakazone/senior-floors-system`.
2. **Variables:** adicione as variáveis do MySQL:
   - `DB_HOST` (ex.: do MySQL addon ou Hostinger)
   - `DB_NAME`
   - `DB_USER`
   - `DB_PASS`
3. Railway define `PORT` automaticamente; o app usa `process.env.PORT`.
4. Após o deploy, a URL será algo como `https://senior-floors-system.up.railway.app`.

## LP (Vercel) → System (Railway)

Na LP (Vercel), defina a variável **`SYSTEM_API_URL`** com a URL do Railway, ex.:

```
SYSTEM_API_URL=https://senior-floors-system.up.railway.app
```

Assim o formulário da LP pode enviar para a Vercel; a Vercel (send-lead) reenvia para o Railway (`/api/receive-lead`) quando quiser gravar no mesmo banco do System.

## Banco de dados

Use o mesmo MySQL do CRM (Hostinger ou Railway MySQL addon). Execute o schema das tabelas `leads` e `users` (e outras que usar). O schema é o mesmo do projeto PHP original (ex.: `database/schema-v3-completo.sql`).

## Local

```bash
cp env.example .env
# Edite .env com DB_*
npm install
npm start
```

Abre em `http://localhost:3000`.

## Documentação

Guias e notas de diagnóstico (todos em `docs/`):

- [CONFIGURACAO_VERCEL.md](docs/CONFIGURACAO_VERCEL.md)
- [DIAGNOSTICO_RAILWAY.md](docs/DIAGNOSTICO_RAILWAY.md)
- [FIX_LEAD_SUBMISSION.md](docs/FIX_LEAD_SUBMISSION.md)
- [SOLUCAO_EMAIL.md](docs/SOLUCAO_EMAIL.md)
- [FUNCIONALIDADES_LEADS.md](docs/FUNCIONALIDADES_LEADS.md)
- [RAILWAY_DEPLOY.md](docs/RAILWAY_DEPLOY.md)
- [CONFIGURAR_GMAIL_APP_PASSWORD.md](docs/CONFIGURAR_GMAIL_APP_PASSWORD.md)
- [TESTE_APP_PASSWORD.md](docs/TESTE_APP_PASSWORD.md)
- [CRM_PROGRESS.md](docs/CRM_PROGRESS.md)
- [NEXT_STEPS.md](docs/NEXT_STEPS.md)
- [google-calendar-setup.md](docs/google-calendar-setup.md)
- [SUPPLIER_PRODUCT_QUOTE_ERP.md](docs/SUPPLIER_PRODUCT_QUOTE_ERP.md)
