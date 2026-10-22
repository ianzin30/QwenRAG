/**
 * Minimal Server-Sent Events decoder for fetch() response bodies.
 * EventSource only supports GET, so turns (POST) are read through this parser.
 * Follows the WHATWG framing rules: CRLF/LF/CR line endings, multi-line `data:`,
 * comments, `event:` and `id:` fields, and frames split across network chunks.
 */

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventName = '';
  private lastId: string | undefined;

  /** Feed a decoded text chunk; returns the complete messages it finished. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    for (;;) {
      const match = /\r\n|\n|\r/.exec(this.buffer);
      if (!match) break;
      // A lone "\r" at the end may be the first half of "\r\n": wait for more input.
      if (match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const message = this.processLine(line);
      if (message) out.push(message);
    }
    return out;
  }

  /** Call when the stream ends; dispatches a trailing frame that lacked the blank line. */
  flush(): SseMessage[] {
    const out: SseMessage[] = [];
    if (this.buffer) {
      const message = this.processLine(this.buffer);
      this.buffer = '';
      if (message) out.push(message);
    }
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }

  private processLine(line: string): SseMessage | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.dataLines.push(value);
    else if (field === 'event') this.eventName = value;
    else if (field === 'id' && !value.includes('\0')) this.lastId = value;
    return null;
  }

  private dispatch(): SseMessage | null {
    if (this.dataLines.length === 0) {
      this.eventName = '';
      return null;
    }
    const message: SseMessage = { event: this.eventName || 'message', data: this.dataLines.join('\n'), id: this.lastId };
    this.dataLines = [];
    this.eventName = '';
    return message;
  }
}

/** Reads an SSE response body as an async iterator. Releases the reader on exit or abort. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    yield* parser.push(decoder.decode());
    yield* parser.flush();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      // A read was still pending after cancel(); the stream is closed either way.
    }
  }
}
