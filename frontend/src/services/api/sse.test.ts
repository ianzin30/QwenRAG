import { describe, expect, it } from 'vitest';
import { readSse, SseParser } from './sse';
import { decodeTurnEvent } from './httpAdapter';

describe('SseParser', () => {
  it('parses frames split across arbitrary chunks', () => {
    const parser = new SseParser();
    const raw = 'event: answer.delta\ndata: {"text":"Olá"}\n\nevent: turn.completed\ndata: {"message":{}}\n\n';
    const out = [];
    for (const ch of raw) out.push(...parser.push(ch));
    expect(out).toEqual([
      { event: 'answer.delta', data: '{"text":"Olá"}', id: undefined },
      { event: 'turn.completed', data: '{"message":{}}', id: undefined },
    ]);
  });

  it('handles CRLF, a CR split from its LF, comments, multi-line data and ids', () => {
    const parser = new SseParser();
    const a = parser.push(': keep-alive\r\nid: 7\r\ndata: a\r');
    const b = parser.push('\ndata: b\r\n\r\n');
    expect(a).toEqual([]);
    expect(b).toEqual([{ event: 'message', data: 'a\nb', id: '7' }]);
  });

  it('ignores frames without data and flushes a trailing frame at end of stream', () => {
    const parser = new SseParser();
    expect(parser.push('event: ping\n\n')).toEqual([]);
    expect(parser.push('data: last')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: 'message', data: 'last', id: undefined }]);
  });
});

describe('readSse', () => {
  const streamOf = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });

  it('decodes UTF-8 split inside a multi-byte character', async () => {
    const bytes = new TextEncoder().encode('data: ação\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 8));
        c.enqueue(bytes.slice(8));
        c.close();
      },
    });
    const out = [];
    for await (const m of readSse(body)) out.push(m.data);
    expect(out).toEqual(['ação']);
  });

  it('stops with AbortError when the signal aborts', async () => {
    const ctrl = new AbortController();
    const body = streamOf(['data: 1\n\n', 'data: 2\n\n']);
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const m of readSse(body, ctrl.signal)) {
          seen.push(m.data);
          ctrl.abort();
        }
      })(),
    ).rejects.toThrow(/Abort/);
    expect(seen).toEqual(['1']);
  });
});

describe('decodeTurnEvent', () => {
  it('maps proposed event names to domain events', () => {
    expect(decodeTurnEvent({ event: 'turn.accepted', data: '{"turn_id":"t1"}' })).toEqual({ type: 'accepted', turnId: 't1', userMessageId: undefined });
    expect(decodeTurnEvent({ event: 'answer.delta', data: '{"text":"x"}' })).toEqual({ type: 'delta', text: 'x' });
    expect(decodeTurnEvent({ event: 'turn.failed', data: '{"outcome":"unknown","message":"m"}' })).toEqual({
      type: 'failed',
      error: { outcome: 'unknown', message: 'm', code: undefined },
    });
  });

  it('ignores unknown events and invalid JSON', () => {
    expect(decodeTurnEvent({ event: 'turn.future_thing', data: '{}' })).toBeNull();
    expect(decodeTurnEvent({ event: 'answer.delta', data: 'not json' })).toBeNull();
  });

  it('maps a completed message with cited sources and claims', () => {
    const event = decodeTurnEvent({
      event: 'turn.completed',
      data: JSON.stringify({
        message: {
          role: 'assistant',
          content: 'A.',
          turn_id: 't1',
          turn_state: 'partial',
          claims: [{ claim_id: 'c1', text: 'A', evidence_ids: ['E1'] }],
          sources: [{ evidence_id: 'X' }],
          cited_sources: [{ evidence_id: 'E1', document_name: 'doc.pdf', provenance: [{ page_no: 3 }, { page_no: 3 }, { page_no: 1 }] }],
        },
      }),
    });
    expect(event?.type).toBe('completed');
    if (event?.type !== 'completed') return;
    expect(event.message.state).toBe('partial');
    expect(event.message.sources).toHaveLength(1); // cited_sources wins over sources (displayed_sources)
    expect(event.message.sources[0]?.pages).toEqual([1, 3]);
    expect(event.message.claims[0]?.evidenceIds).toEqual(['E1']);
  });
});
