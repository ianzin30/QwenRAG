import type { AssistantMessage, DocumentMeta, Source } from '../../services/api';
import type { Highlight } from '../../app/store/state';
import { validSpans } from '../../lib/highlight';

/** Citation number = 1-based position in the message's source list (Engine orders sources by claim). */
export function citationNumber(message: AssistantMessage, evidenceId: string): number | null {
  const i = message.sources.findIndex((s) => s.evidenceId === evidenceId);
  return i === -1 ? null : i + 1;
}

/** Finds the library document behind a source: explicit id first, then relative path, then file name. */
export function resolveDocument(source: Source, documents: DocumentMeta[]): DocumentMeta | undefined {
  if (source.documentId) return documents.find((d) => d.id === source.documentId);
  const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase();
  return (
    documents.find((d) => source.relativePath && d.relativePath === source.relativePath) ??
    documents.find((d) => stem(d.name) === stem(source.documentName))
  );
}

export function highlightFor(source: Source, n: number): Highlight | undefined {
  const span = validSpans(source)[0];
  if (!span) return undefined;
  return {
    before: source.excerpt.slice(Math.max(0, span.start - 160), span.start),
    quote: span.quote,
    after: source.excerpt.slice(span.end, span.end + 160),
    sourceLabel: `Fonte ${n}`,
  };
}

export const isLegacy = (message: AssistantMessage) => !message.turnId;
