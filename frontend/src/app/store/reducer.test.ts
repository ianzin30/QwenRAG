import { describe, expect, it } from 'vitest';
import { reducer } from './reducer';
import { DEFAULT_STAGES, initialState, type AppState, type TurnRuntime } from './state';
import type { AssistantMessage } from '../../services/api';

const runtime = (id: string): TurnRuntime => ({
  clientTurnId: id,
  question: 'Pergunta?',
  userMessageId: `local-${id}`,
  status: 'streaming',
  stages: DEFAULT_STAGES,
  activeStage: 'analyzing',
  text: '',
  startedAt: Date.parse('2026-10-20T10:00:00Z'),
});

const answer: AssistantMessage = {
  id: 'a1',
  role: 'assistant',
  turnId: 't1',
  content: 'Resposta.',
  claims: [],
  sources: [],
  state: 'answered',
  route: 'retrieval',
  collections: ['graduacao'],
  warnings: [],
  createdAt: '2026-10-20T10:00:05Z',
};

function started(): AppState {
  const base: AppState = {
    ...initialState,
    conversations: [{ id: 'c1', title: 'Nova conversa', updatedAt: '2026-10-19T10:00:00Z', collections: [] }],
    messages: { c1: { status: 'ready', items: [] } },
  };
  return reducer(base, { type: 'turn/started', conversationId: 'c1', runtime: runtime('x'), title: 'Pergunta?' });
}

describe('turn lifecycle', () => {
  it('adds the user message immediately and renames a new conversation', () => {
    const s = started();
    expect(s.messages.c1?.items.map((m) => m.role)).toEqual(['user']);
    expect(s.turns.c1?.status).toBe('streaming');
    expect(s.conversations[0]?.title).toBe('Pergunta?');
  });

  it('accumulates deltas and completes into an assistant message', () => {
    let s = started();
    s = reducer(s, { type: 'turn/delta', conversationId: 'c1', clientTurnId: 'x', text: 'Res' });
    s = reducer(s, { type: 'turn/delta', conversationId: 'c1', clientTurnId: 'x', text: 'posta' });
    expect(s.turns.c1?.text).toBe('Resposta');
    s = reducer(s, { type: 'turn/completed', conversationId: 'c1', clientTurnId: 'x', message: answer });
    expect(s.turns.c1).toBeUndefined();
    expect(s.messages.c1?.items.map((m) => m.id)).toEqual(['local-x', 'a1']);
  });

  it('drops late events from a stale turn', () => {
    const s = started();
    const after = reducer(s, { type: 'turn/delta', conversationId: 'c1', clientTurnId: 'other', text: 'zzz' });
    expect(after).toBe(s);
  });

  it('never appends the same assistant message twice', () => {
    let s = started();
    s = reducer(s, { type: 'turn/completed', conversationId: 'c1', clientTurnId: 'x', message: answer });
    s = reducer(s, { type: 'turn/started', conversationId: 'c1', runtime: runtime('y') });
    s = reducer(s, { type: 'turn/completed', conversationId: 'c1', clientTurnId: 'y', message: answer });
    expect(s.messages.c1?.items.filter((m) => m.id === 'a1')).toHaveLength(1);
  });

  it('inserts unknown backend stages after the active one', () => {
    let s = started();
    s = reducer(s, { type: 'turn/progress', conversationId: 'c1', clientTurnId: 'x', stage: 'retrieving' });
    s = reducer(s, { type: 'turn/progress', conversationId: 'c1', clientTurnId: 'x', stage: 'hop_2', label: 'Segunda busca' });
    expect(s.turns.c1?.stages.map((st) => st.stage)).toEqual(['analyzing', 'retrieving', 'hop_2', 'reranking', 'generating']);
  });

  it('keeps a failed turn until dismissed; retry removes the orphan question', () => {
    let s = started();
    s = reducer(s, { type: 'turn/failed', conversationId: 'c1', clientTurnId: 'x', error: { outcome: 'failed', message: 'erro' } });
    expect(s.turns.c1?.status).toBe('failed');
    const dismissed = reducer(s, { type: 'turn/dismissed', conversationId: 'c1', removeQuestion: true });
    expect(dismissed.turns.c1).toBeUndefined();
    expect(dismissed.messages.c1?.items).toEqual([]);
  });

  it('cannot dismiss a turn that is still streaming', () => {
    const s = started();
    expect(reducer(s, { type: 'turn/dismissed', conversationId: 'c1', removeQuestion: true })).toBe(s);
  });

  it('keeps turns per conversation when switching', () => {
    let s = started();
    s = reducer(s, { type: 'conversation/selected', id: 'c2' });
    expect(s.turns.c1?.status).toBe('streaming');
  });
});
