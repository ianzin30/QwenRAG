/**
 * DEMO DATA ONLY — used by the mock adapter in `npm run dev:mock`.
 * Content is illustrative; bracketed values such as [data-limite] are placeholders,
 * not facts about UFC regulations.
 */
import type { AssistantMessage, Claim, DocumentMeta, Source } from '../services/api/types';

interface SourceSeed {
  doc: string;
  documentId: string;
  kind: string;
  section: string;
  page?: number;
  before: string;
  hit: string;
  after: string;
}

interface AnswerSeed {
  seconds: number;
  parts: (string | number)[]; // strings are claim text, numbers cite the n-th source
  sources: SourceSeed[];
}

const DOCS = {
  cal: { doc: 'calendario_academico_2026.pdf', documentId: 'd1', kind: 'text', section: 'Calendário 2026.1', page: 3 },
  reg: { doc: 'regulamento_graduacao.md', documentId: 'd2', kind: 'text', section: 'Trancamento e aproveitamento', page: 18 },
  faq: { doc: 'faq_secretaria.xlsx', documentId: 'd3', kind: 'table', section: 'Aba Matrícula' },
  ppc: { doc: 'ppc_computacao.pdf', documentId: 'd4', kind: 'text', section: 'Estrutura curricular', page: 24 },
};

export const ANSWERS: Record<'tranc' | 'aprov' | 'ppc' | 'none', AnswerSeed> = {
  tranc: {
    seconds: 3.4,
    parts: [
      'O trancamento de disciplina em 2026.1 pode ser solicitado até a data-limite publicada no calendário acadêmico', 1,
      'O pedido é feito no sistema acadêmico, na área de matrícula', 3,
      'Não é possível trancar de novo um componente que já foi trancado em período anterior', 2,
    ],
    sources: [
      { ...DOCS.cal, before: 'Período para solicitação de ', hit: 'trancamento de disciplinas: de [data inicial] a [data-limite]', after: ', conforme resolução vigente.' },
      { ...DOCS.reg, before: 'Parágrafo único. É ', hit: 'vedado o trancamento de componente curricular já trancado', after: ' em período letivo anterior.' },
      { ...DOCS.faq, before: 'A ', hit: 'solicitação é feita pelo sistema acadêmico', after: ', na área de matrícula, opção trancamento.' },
    ],
  },
  aprov: {
    seconds: 2.9,
    parts: [
      'O aproveitamento de estudos é pedido à coordenação do curso, com histórico e programas das disciplinas já cursadas', 1,
      'A análise compara carga horária e conteúdo de cada componente antes do deferimento', 2,
    ],
    sources: [
      { ...DOCS.reg, before: 'O discente deverá ', hit: 'requerer o aproveitamento à coordenação, anexando histórico e programas', after: ' das disciplinas cursadas.' },
      { ...DOCS.faq, before: 'Na análise ', hit: 'são comparados carga horária e conteúdo programático', after: ' de cada componente.' },
    ],
  },
  ppc: {
    seconds: 4.1,
    parts: [
      'O PPC de Computação organiza o curso em núcleo básico, núcleo profissionalizante e optativas', 1,
      'O estágio supervisionado e o trabalho de conclusão ficam nos semestres finais', 2,
    ],
    sources: [
      { ...DOCS.ppc, before: 'A matriz curricular ', hit: 'divide-se em núcleo básico, profissionalizante e optativas', after: '.' },
      { ...DOCS.ppc, section: 'Estágio e TCC', page: 41, before: 'Nos semestres finais, ', hit: 'o estágio supervisionado e o TCC', after: ' completam a formação.' },
    ],
  },
  none: {
    seconds: 2.2,
    parts: [
      'Não encontrei um trecho que responda exatamente a isso nas coleções ativas. O documento mais próximo trata de prazos acadêmicos', 1,
      'Tente citar o documento ou o tema específico, ou ative outra coleção no topo.',
    ],
    sources: [{ ...DOCS.cal, before: 'Seção ', hit: 'prazos e procedimentos acadêmicos', after: ' do semestre.' }],
  },
};

export function pickAnswer(question: string): keyof typeof ANSWERS {
  const q = question.toLowerCase();
  if (q.includes('tranc')) return 'tranc';
  if (q.includes('aproveit')) return 'aprov';
  if (q.includes('ppc') || q.includes('resum') || q.includes('curso')) return 'ppc';
  return 'none';
}

/** Builds an AssistantMessage shaped exactly like the HTTP adapter would deliver it. */
export function buildAnswer(
  key: keyof typeof ANSWERS,
  meta: { id: string; turnId: string; model: { id: string; label: string }; collections: string[]; createdAt: string },
): AssistantMessage {
  const seed = ANSWERS[key];
  const sources: Source[] = seed.sources.map((s, i) => {
    const excerpt = `${s.before}${s.hit}${s.after}\n\n[continuação do trecho indexado, como está no chunk]`;
    const start = s.before.length;
    return {
      sourceId: `${meta.turnId}-s${i + 1}`,
      evidenceId: `E${i + 1}`,
      documentName: s.doc,
      documentId: s.documentId,
      chunkKind: s.kind,
      sectionTitle: s.section,
      excerpt,
      relativePath: `${'graduacao'}/${s.doc.replace(/\.[^.]+$/, '.md')}`,
      pages: s.page ? [s.page] : [],
      claimIds: [],
      focusSpans: [{ start, end: start + s.hit.length, quote: s.hit, claimIds: [] }],
    };
  });
  const claims: Claim[] = [];
  for (const part of seed.parts) {
    if (typeof part === 'string') claims.push({ claimId: `c${claims.length + 1}`, text: part, evidenceIds: [] });
    else {
      const claim = claims[claims.length - 1];
      const source = sources[part - 1];
      if (claim && source) {
        claim.evidenceIds.push(source.evidenceId);
        source.claimIds.push(claim.claimId);
        source.focusSpans.forEach((f) => f.claimIds.push(claim.claimId));
      }
    }
  }
  return {
    id: meta.id,
    role: 'assistant',
    turnId: meta.turnId,
    content: claims.map((c) => (/[.!?]$/.test(c.text) ? c.text : `${c.text}.`)).join(' '),
    claims,
    sources,
    state: key === 'none' ? 'abstained' : 'answered',
    route: 'retrieval',
    model: meta.model,
    collections: meta.collections,
    durationMs: seed.seconds * 1000,
    warnings: [],
    execution: { logical_calls: 4, transport_attempts: 4, mock: true },
    createdAt: meta.createdAt,
  };
}

export const MODELS = [
  { id: 'nvidia/Qwen3.6-35B-A3B-NVFP4', label: 'Qwen 3.6 — Spark', isDefault: true },
  { id: 'phi4:latest', label: 'Phi-4 (Cumbuco)', isDefault: false },
];

const day = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const DOCUMENTS: DocumentMeta[] = [
  { id: 'd1', collection: 'graduacao', name: 'calendario_academico_2026.pdf', extension: 'PDF', relativePath: 'graduacao/calendario_academico_2026.md', updatedAt: ago(2 * day), summary: '32 p.' },
  { id: 'd2', collection: 'graduacao', name: 'regulamento_graduacao.md', extension: 'MD', relativePath: 'graduacao/regulamento_graduacao.md', updatedAt: ago(7 * day), summary: '18 seções' },
  { id: 'd3', collection: 'graduacao', name: 'faq_secretaria.xlsx', extension: 'XLSX', relativePath: 'graduacao/faq_secretaria.md', updatedAt: ago(3_600_000), summary: '4 abas' },
  { id: 'd4', collection: 'graduacao', name: 'ppc_computacao.pdf', extension: 'PDF', relativePath: 'graduacao/ppc_computacao.md', updatedAt: ago(3 * day), summary: '64 p.' },
  { id: 'd5', collection: 'pos_graduacao', name: 'edital_mestrado_2026.pdf', extension: 'PDF', relativePath: 'pos_graduacao/edital_mestrado_2026.md', updatedAt: ago(21 * day), summary: '12 p.' },
  { id: 'd6', collection: 'pos_graduacao', name: 'resolucao_bolsas.docx', extension: 'DOCX', relativePath: 'pos_graduacao/resolucao_bolsas.md', updatedAt: ago(30 * day), summary: '6 p.' },
];

export function documentMarkdown(doc: DocumentMeta): string {
  return [
    `# ${doc.name}`,
    '',
    '[Introdução do documento, extraída do arquivo original e convertida em Markdown pela ingestão.]',
    '',
    '## [Seção]',
    '',
    'Conteúdo de demonstração. No modo real, este texto vem de `GET /documents/{id}/content`.',
    '',
    '- [item da lista]',
    '- [item da lista]',
    '',
    '| [coluna] | [coluna] | [coluna] |',
    '| --- | --- | --- |',
    '| [valor] | [valor] | [valor] |',
    '',
    '<script>alert("este HTML não é executado")</script>',
  ].join('\n');
}

export const SEED_CONVERSATIONS: { id: string; title: string; ageMs: number; question: string; answer: keyof typeof ANSWERS }[] = [
  { id: 'c1', title: 'Prazo de trancamento 2026.1', ageMs: 20 * 60_000, question: 'Até quando posso trancar uma disciplina em 2026.1?', answer: 'tranc' },
  { id: 'c2', title: 'Aproveitamento de estudos', ageMs: 3 * 3_600_000, question: 'Como solicito aproveitamento de estudos?', answer: 'aprov' },
  { id: 'c3', title: 'Resumo do PPC de Computação', ageMs: day + 3_600_000, question: 'Resuma o PPC de Computação', answer: 'ppc' },
  { id: 'c4', title: 'Bolsas de monitoria', ageMs: 9 * day, question: 'Quais bolsas de monitoria existem?', answer: 'none' },
];
