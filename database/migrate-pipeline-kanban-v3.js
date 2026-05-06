/**
 * Pipeline Kanban v3  9 colunas (iPad): New Lead ? Lost.
 * Idempotente: pode rodar mais de uma vez.
 *
 * Run: node database/migrate-pipeline-kanban-v3.js
 * Requer: DB_* no .env (igual ao app).
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const KANBAN_STAGES = [
  { slug: 'new_lead', name: 'Novo lead', order_num: 1, color: '#3498db', is_closed: 0 },
  { slug: 'contacted', name: 'Contato realizado', order_num: 2, color: '#f39c12', is_closed: 0 },
  { slug: 'meeting_scheduled', name: 'Reunião agendada', order_num: 3, color: '#e67e22', is_closed: 0 },
  { slug: 'quote_sent', name: 'Orçamento enviado', order_num: 4, color: '#9b59b6', is_closed: 0 },
  { slug: 'follow_up_1', name: 'Follow-up 1', order_num: 5, color: '#16a085', is_closed: 0 },
  { slug: 'follow_up_2', name: 'Follow-up 2', order_num: 6, color: '#1abc9c', is_closed: 0 },
  { slug: 'closing_attempt', name: 'Tentativa de fechamento', order_num: 7, color: '#e74c3c', is_closed: 0 },
  { slug: 'won', name: 'Ganho', order_num: 8, color: '#27ae60', is_closed: 1 },
  { slug: 'lost', name: 'Perdido', order_num: 9, color: '#c0392b', is_closed: 1 },
];

const FINAL_SLUGS = new Set(KANBAN_STAGES.map((s) => s.slug));

/** Map estgio legado ou status legado ? slug novo */
function mapToNewSlug(effectiveSlug, leadStatus) {
  const s = (effectiveSlug || leadStatus || '').trim();
  const legacy = {
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
  if (legacy[s]) return legacy[s];
  if (FINAL_SLUGS.has(s)) return s;
  return 'new_lead';
}

async function upsertStages(conn) {
  for (const st of KANBAN_STAGES) {
    await conn.execute(
      `INSERT INTO pipeline_stages (name, slug, description, order_num, color, is_closed, is_active)
       VALUES (?, ?, '', ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         order_num = VALUES(order_num),
         color = VALUES(color),
         is_closed = VALUES(is_closed),
         is_active = 1`,
      [st.name, st.slug, st.order_num, st.color, st.is_closed]
    );
  }
}

async function main() {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASS;
  const database = process.env.DB_NAME;
  if (!host || !user || !database) {
    console.error('Defina DB_HOST, DB_USER, DB_PASS e DB_NAME no .env');
    process.exit(1);
  }

  const conn = await mysql.createConnection({ host, user, password, database });

  console.log('Migrando pipeline Kanban v3...');
  await conn.beginTransaction();

  try {
    await upsertStages(conn);

    const [slugRows] = await conn.query('SELECT id, slug FROM pipeline_stages');
    const idBySlug = new Map(slugRows.map((r) => [r.slug, r.id]));

    const [leads] = await conn.query(
      `SELECT l.id, l.status, l.pipeline_stage_id, ps.slug AS ps_slug
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id`
    );

    for (const row of leads) {
      const effective = row.ps_slug || row.status;
      const newSlug = mapToNewSlug(effective, row.status);
      const newId = idBySlug.get(newSlug);
      if (!newId) continue;
      if (row.pipeline_stage_id === newId && (row.status === newSlug || mapToNewSlug(row.status, row.status) === newSlug)) {
        continue;
      }
      await conn.execute('UPDATE leads SET pipeline_stage_id = ?, status = ? WHERE id = ?', [
        newId,
        newSlug,
        row.id,
      ]);
    }

    await conn.execute(
      `UPDATE pipeline_stages SET is_active = 0 WHERE slug NOT IN (${[...FINAL_SLUGS].map(() => '?').join(',')})`,
      [...FINAL_SLUGS]
    );

    await conn.commit();
    console.log('OK  estgios atualizados e leads migrados.');
    const [summary] = await conn.query(
      `SELECT ps.slug, COUNT(l.id) AS n
       FROM pipeline_stages ps
       LEFT JOIN leads l ON l.pipeline_stage_id = ps.id
       WHERE ps.slug IN (${[...FINAL_SLUGS].map(() => '?').join(',')})
       GROUP BY ps.slug, ps.order_num
       ORDER BY ps.order_num`,
      [...FINAL_SLUGS]
    );
    console.table(summary);
  } catch (e) {
    await conn.rollback();
    console.error(e);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
