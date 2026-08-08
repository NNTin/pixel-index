import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pixelindex_theme';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : systemTheme();
}

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

/** Persists across visits (localStorage), defaults to the OS preference — matches the docs site's own toggle. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  return <ThemeContext value={{ theme, toggleTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
