import { describe, expect, it } from 'vitest';
import { compactPreview, sentenceContext, validSpans } from './highlight';
import { groupConversations, truncateTitle } from './format';
import type { Source } from '../services/api';

const excerpt = 'Primeira frase. Período para trancamento de disciplinas: até 10/05. Última frase!';
const start = excerpt.indexOf('trancamento');
const end = start + 'trancamento de disciplinas'.length;

const source: Source = {
  sourceId: 's',
  evidenceId: 'E1',
  documentName: 'cal.pdf',
  chunkKind: 'text',
  sectionTitle: '',
  excerpt,
  relativePath: '',
  pages: [],
  claimIds: [],
  focusSpans: [
    { start, end, quote: 'trancamento de disciplinas', claimIds: ['c1'] },
    { start: 0, end: 3, quote: 'xyz', claimIds: [] }, // quote mismatch → dropped
  ],
};

describe('highlight (ports of Chat.py helpers)', () => {
  it('keeps only spans whose quote matches the excerpt', () => {
    expect(validSpans(source)).toHaveLength(1);
  });

  it('extracts the sentence around a span like _sentence_context', () => {
    const ctx = sentenceContext(excerpt, validSpans(source)[0]!);
    expect(ctx.before).toBe('Período para ');
    expect(ctx.hit).toBe('trancamento de disciplinas');
    expect(ctx.after).toBe(': até 10/05.');
    expect(ctx.leadingEllipsis).toBe(true);
    expect(ctx.trailingEllipsis).toBe(true);
  });

  it('builds a compact window around the first span', () => {
    const p = compactPreview(source, 30);
    expect(p.hit.length).toBeGreaterThan(0);
    expect(p.before.length + p.hit.length + p.after.length).toBeLessThanOrEqual(30);
  });

  it('falls back to the excerpt start when no span is valid', () => {
    const p = compactPreview({ ...source, focusSpans: [] }, 10);
    expect(p).toMatchObject({ before: 'Primeira f', hit: '', trailingEllipsis: true });
  });
});

describe('format', () => {
  it('groups history as Hoje / Ontem / Anteriores', () => {
    const now = new Date('2026-10-20T12:00:00');
    const groups = groupConversations(
      [
        { id: 'a', title: 'a', updatedAt: new Date('2026-10-20T09:00:00').toISOString(), collections: [] },
        { id: 'b', title: 'b', updatedAt: new Date('2026-10-19T09:00:00').toISOString(), collections: [] },
        { id: 'c', title: 'c', updatedAt: new Date('2026-10-01T09:00:00').toISOString(), collections: [] },
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Hoje', ['a']],
      ['Ontem', ['b']],
      ['Anteriores', ['c']],
    ]);
  });

  it('truncates titles to the configured length', () => {
    expect(truncateTitle('Até quando posso trancar uma disciplina em 2026.1?', 34)).toHaveLength(34);
  });
});
