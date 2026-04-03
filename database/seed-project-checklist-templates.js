/**
 * Itens padrão do checklist de vistoria — inseridos em `project_checklist` na criação do projeto.
 */
export const CHECKLIST_TEMPLATE = [
  { category: 'Instalação', item: 'Subfloor preparado e nivelado' },
  { category: 'Instalação', item: 'Moisture barrier instalado (se aplicável)' },
  { category: 'Instalação', item: 'Direção das tábuas conforme projeto' },
  { category: 'Instalação', item: 'Expansão nas bordas respeitada (3/4")' },
  { category: 'Instalação', item: 'Transições instaladas corretamente' },
  { category: 'Instalação', item: 'Rodapés recolocados ou instalados' },
  { category: 'Acabamento', item: 'Superfície sem arranhões visíveis' },
  { category: 'Acabamento', item: 'Rejuntes preenchidos (se tile)' },
  { category: 'Acabamento', item: 'Stain/finish uniforme (se hardwood)' },
  { category: 'Acabamento', item: 'Brilho/matte conforme especificado' },
  { category: 'Nivelamento', item: 'Piso sem empenamentos visíveis' },
  { category: 'Nivelamento', item: 'Juntas sem gaps ou sobreposições' },
  { category: 'Limpeza', item: 'Sobras de material retiradas' },
  { category: 'Limpeza', item: 'Pó e resíduos removidos' },
  { category: 'Limpeza', item: 'Proteção removida das áreas não afetadas' },
  { category: 'Documentação', item: 'Fotos do antes e depois tiradas' },
  { category: 'Documentação', item: 'Quantidade de material extra registrada' },
  { category: 'Documentação', item: 'Notas de garantia entregues ao cliente' },
];

/**
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').Connection} conn
 * @param {number} projectId
 */
export async function insertChecklistTemplate(conn, projectId) {
  const vals = CHECKLIST_TEMPLATE.map((row) => [projectId, row.category, row.item]);
  if (!vals.length) return;
  await conn.query(
    `INSERT INTO project_checklist (project_id, category, item) VALUES ?`,
    [vals]
  );
}
