/** Small presentational pieces reused across features. */
import type { ReactNode } from 'react';

export function Spinner({ size = 12 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function ProgressBar({ percent, done, label }: { percent: number; done?: boolean; label: string }) {
  return (
    <div className={`progress${done ? ' progress--done' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}

export function ExtBadge({ ext }: { ext: string }) {
  return <span className="ext-badge">{(ext || 'ARQ').slice(0, 4)}</span>;
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`section-label${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function Skeleton({ width, height = 12, className }: { width: string; height?: number; className?: string }) {
  return <div className={`skeleton${className ? ` ${className}` : ''}`} style={{ width, height }} aria-hidden="true" />;
}
