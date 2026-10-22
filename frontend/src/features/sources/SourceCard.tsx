import type { Source } from '../../services/api';
import { compactPreview, sourceMeta } from '../../lib/highlight';

interface SourceCardProps {
  source: Source;
  n: number;
  active?: boolean;
  variant: 'grid' | 'rail';
  previewChars: number;
  onSelect: () => void;
  controls?: string;
}

/** Compact citation card. Grid on desktop (expands inline), horizontal rail on mobile (opens a sheet). */
export function SourceCard({ source, n, active, variant, previewChars, onSelect, controls }: SourceCardProps) {
  const preview = compactPreview(source, previewChars);
  return (
    <button
      type="button"
      className={`source-card source-card--${variant}${active ? ' is-active' : ''}`}
      onClick={onSelect}
      aria-expanded={variant === 'grid' ? !!active : undefined}
      aria-controls={controls}
      aria-label={`Fonte ${n}: ${source.documentName}`}
    >
      <span className="source-card__head">
        <span className="cite-num">{n}</span>
        <span className="source-card__doc">{source.documentName}</span>
      </span>
      {variant === 'grid' && <span className="source-card__meta mono">{sourceMeta(source)}</span>}
      <span className="source-card__snippet">
        {preview.hit ? `… ${preview.hit} …` : `${preview.before}${preview.trailingEllipsis ? ' …' : ''}`}
      </span>
      {variant === 'rail' && <span className="source-card__meta mono">{source.pages.length ? `${source.chunkKind} · p. ${source.pages.join(', ')}` : source.chunkKind}</span>}
    </button>
  );
}
