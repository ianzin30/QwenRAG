import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';

type Preference = 'system' | 'light' | 'dark';
type Resolved = 'light' | 'dark';

interface ThemeValue {
  theme: Resolved;
  preference: Preference;
  toggle: () => void;
}

const STORAGE_KEY = 'rag-ufc:theme';
const ThemeContext = createContext<ThemeValue | null>(null);

function readPreference(): Preference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(readPreference);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme: Resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Resolved = theme === 'dark' ? 'light' : 'dark';
    setPreference(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode): the choice lasts for this session only.
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, preference, toggle }), [theme, preference, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
