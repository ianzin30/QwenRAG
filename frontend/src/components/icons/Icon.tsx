import type { CSSProperties } from 'react';

/** Stroke icons taken from the prototypes (24×24 grid, 1.6 stroke, round caps). */
const PATHS = {
  chat: <path d="M5.5 5.5h13a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H9.2l-4.7 3v-3.1a2 2 0 0 1-1-1.7V7.5a2 2 0 0 1 2-2Z" />,
  folder: <path d="M3.5 6.5h6.2l2 2h8.8v9.8a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2V6.5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7" />,
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  paperclip: <path d="m20 11.5-7.6 7.6a4.6 4.6 0 0 1-6.5-6.5l8-8a3 3 0 0 1 4.3 4.3l-7.9 7.9a1.5 1.5 0 0 1-2.1-2.1l7.3-7.3" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />,
  drive: (
    <>
      <path d="M8.5 4h7l5.5 9.5-3.5 6h-11L3 13.5 8.5 4Z" />
      <path d="M8.5 4l6 9.5H21M15.5 4 9 15.5M3 13.5l3.5 6" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  edit: <path d="M12 20h8M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4Z" />,
  user: (
    <>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Brand mark from the prototypes: three text lines and an accent dot. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      <rect width="28" height="28" rx="8" fill="var(--primary)" />
      <path d="M8 9.5h8M8 14h12M8 18.5h6" stroke="var(--on-primary)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="18.5" r="2" fill="var(--accent)" />
    </svg>
  );
}
