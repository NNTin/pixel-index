import { type ReactNode, useEffect, useState } from 'react';

import { type Theme, ThemeContext } from './themeState';

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
