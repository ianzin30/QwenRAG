import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus trap + Escape + focus restore, shared by Dialog, Sheet and Drawer. */
function useModalBehavior(open: boolean, onClose: () => void, panel: RefObject<HTMLElement>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    node?.addEventListener('keydown', onKey);
    return () => {
      node?.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, panel]);
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Visually hide the title (it still names the dialog for assistive tech). */
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
}

/** Centered modal dialog (desktop delete confirmation). */
export function Dialog({ open, onClose, title, hideTitle, children, className }: OverlayProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(open, onClose, panel);
  if (!open) return null;
  return createPortal(
    <div className="overlay-root">
      <div className="scrim anim-fade" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`dialog anim-rise ${className ?? ''}`}>
        <h2 id={titleId} className={hideTitle ? 'sr-only' : 'dialog__title'}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Bottom sheet (mobile). */
export function Sheet({ open, onClose, title, hideTitle, children, className }: OverlayProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(open, onClose, panel);
  if (!open) return null;
  return createPortal(
    <div className="overlay-root">
      <div className="scrim anim-fade" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`sheet ${className ?? ''}`}>
        <div className="sheet__grab" aria-hidden="true">
          <span />
        </div>
        <h2 id={titleId} className={hideTitle ? 'sr-only' : 'sheet__title'}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Left drawer (mobile navigation). */
export function Drawer({ open, onClose, title, children }: OverlayProps) {
  const panel = useRef<HTMLDivElement>(null);
  useModalBehavior(open, onClose, panel);
  if (!open) return null;
  return createPortal(
    <div className="overlay-root">
      <div className="scrim anim-fade" onClick={onClose} />
      <aside ref={panel} className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        {children}
      </aside>
    </div>,
    document.body,
  );
}
