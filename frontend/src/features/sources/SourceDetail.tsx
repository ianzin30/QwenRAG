import { useId, useState } from 'react';
import type { Source } from '../../services/api';
import { compactPreview, sentenceContext, sourceMeta, validSpans } from '../../lib/highlight';
import { HighlightedQuote } from './HighlightedQuote';
import { Icon } from '../../components/icons/Icon';

interface SourceDetailProps {
  source: Source;
  previewChars: number;
  canOpenDocument: boolean;
  onOpenDocument: () => void;
  size?: 'md' | 'lg';
}

/** Expanded source content shared by the desktop inline panel and the mobile sheet. */
export function SourceDetail({ source, previewChars, canOpenDocument, onOpenDocument, size = 'md' }: SourceDetailProps) {
  const [showFull, setShowFull] = useState(false);
  const fullId = useId();
  const spans = validSpans(source);

  return (
    <div className={`source-detail source-detail--${size}`}>
      {spans.length > 0 ? (
        spans.map((span) => (
          <div key={`${span.start}-${span.end}`} className="source-detail__span">
            {span.claimIds.length > 0 && <div className="source-detail__claims mono">Sustenta: {span.claimIds.join(', ')}</div>}
            <blockquote className="source-detail__quote">
              <HighlightedQuote text={sentenceContext(source.excerpt, span)} />
            </blockquote>
          </div>
        ))
      ) : source.excerpt ? (
        <blockquote className="source-detail__quote">
          <HighlightedQuote text={compactPreview(source, previewChars)} />
        </blockquote>
      ) : null}

      {showFull && (
        <pre id={fullId} className="source-detail__full mono anim-expand">
          {source.excerpt}
        </pre>
      )}
      <div className="source-detail__actions">
        {source.excerpt && (
          <button type="button" className="link-btn" aria-expanded={showFull} aria-controls={fullId} onClick={() => setShowFull((v) => !v)}>
            {size === 'lg' && <Icon name="chevronRight" size={16} className={showFull ? 'rotate-90' : undefined} />}
            {showFull ? 'Ocultar excerto completo' : 'Ver excerto completo'}
          </button>
        )}
        {canOpenDocument && size === 'md' && (
          <button type="button" className="link-btn" onClick={onOpenDocument}>
            Abrir documento
          </button>
        )}
      </div>
    </div>
  );
}

/** citationLabel: "Fonte citada" for new answers, "Fonte histórica" for legacy ones (Chat._render_message). */
export function SourceDetailHeading({ source, n, citationLabel }: { source: Source; n: number; citationLabel: string }) {
  return (
    <>
      <span className="cite-num cite-num--solid cite-num--lg">{n}</span>
      <span className="source-heading__text">
        <span className="source-heading__doc">{source.documentName}</span>
        <span className="source-heading__meta mono">
          {sourceMeta(source)} · {citationLabel}
        </span>
      </span>
    </>
  );
}
