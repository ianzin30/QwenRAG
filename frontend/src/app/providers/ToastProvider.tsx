import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/icons/Icon';

type Tone = 'neutral' | 'error';
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

const ToastContext = createContext<((text: string, tone?: Tone) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);

  const show = useCallback((text: string, tone: Tone = 'neutral') => {
    clearTimeout(timer.current);
    setToast({ id: ++seq.current, text, tone });
    timer.current = setTimeout(() => setToast(null), tone === 'error' ? 5200 : 2600);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast${toast.tone === 'error' ? ' toast--error' : ''}`}>
            <Icon name={toast.tone === 'error' ? 'alert' : 'check'} size={16} />
            {toast.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
