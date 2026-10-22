import type { FocusSpan, Source } from '../services/api';

/** Text split into plain and highlighted runs, rendered as React nodes (never as HTML). */
export interface HighlightedText {
  before: string;
  hit: string;
  after: string;
  leadingEllipsis: boolean;
  trailingEllipsis: boolean;
}

/** Spans whose offsets and quote match the excerpt, sorted — same guard as Chat._valid_focus_spans. */
export function validSpans(source: Source): FocusSpan[] {
  const text = source.excerpt;
  return source.focusSpans
    .filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.start < s.end && s.end <= text.length && text.slice(s.start, s.end) === s.quote)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Compact preview: window of `maxChars` around the first focus span (Chat.render_sources). */
export function compactPreview(source: Source, maxChars: number): HighlightedText {
  const text = source.excerpt;
  const span = validSpans(source)[0];
  if (!span) {
    const cut = text.length > maxChars;
    return { before: text.slice(0, maxChars), hit: '', after: '', leadingEllipsis: false, trailingEllipsis: cut };
  }
  const start = Math.max(0, span.start - Math.floor(maxChars / 3));
  const end = Math.min(text.length, start + maxChars);
  const hitEnd = Math.min(span.end, end);
  return {
    before: text.slice(start, span.start),
    hit: text.slice(span.start, hitEnd),
    after: text.slice(hitEnd, end),
    leadingEllipsis: start > 0,
    trailingEllipsis: end < text.length,
  };
}

/** Sentence around a span — port of Chat._sentence_context. */
export function sentenceContext(text: string, span: FocusSpan): HighlightedText {
  const head = text.slice(0, span.start);
  const previous = Math.max(head.lastIndexOf('.'), head.lastIndexOf('!'), head.lastIndexOf('?'));
  const next = /[.!?](?:\s|$)/.exec(text.slice(span.end));
  const start = previous >= 0 ? previous + 1 : 0;
  const end = Math.min(text.length, next ? span.end + next.index + next[0].length : text.length);
  return {
    before: text.slice(start, span.start).replace(/^\s+/, ''),
    hit: text.slice(span.start, span.end),
    after: text.slice(span.end, end).replace(/\s+$/, ''),
    leadingEllipsis: start > 0,
    trailingEllipsis: end < text.length,
  };
}

export function sourceMeta(source: Source): string {
  const parts = [source.chunkKind];
  if (source.sectionTitle) parts.push(source.sectionTitle);
  if (source.pages.length) parts.push(`p. ${source.pages.join(', ')}`);
  return parts.join(' · ');
}
