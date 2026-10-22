import type { HighlightedText } from '../../lib/highlight';

/** Renders highlighted text as React nodes, so excerpt content is always escaped. */
export function HighlightedQuote({ text, className }: { text: HighlightedText; className?: string }) {
  return (
    <span className={className}>
      {text.leadingEllipsis && '… '}
      {text.before}
      {text.hit && <mark>{text.hit}</mark>}
      {text.after}
      {text.trailingEllipsis && ' …'}
    </span>
  );
}
