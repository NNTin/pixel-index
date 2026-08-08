import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pixelindex_theme';

function initialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Defaults to dark, not the OS preference: the office itself (the
  // primary design source, see index.css) has no light mode at all — light
  // is an option the docs site offers, not the "true" identity, so a
  // visitor's system light-mode preference shouldn't be what decides a
  // first-time look that's supposed to read as "the office."
  return stored === 'light' || stored === 'dark' ? stored : 'dark';
}

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

/** Persists across visits (localStorage); defaults to dark — see initialTheme's comment. */
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
