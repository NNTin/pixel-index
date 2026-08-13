import { createContext, useContext } from 'react';

export type Theme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

/**
 * The context and its hook, apart from the provider component that fills it.
 *
 * Not stylistic: react-refresh only replaces a module in place if everything it
 * exports is a component, so a file exporting both `ThemeProvider` and
 * `useTheme` forces a full reload on every edit to either. See
 * react-refresh/only-export-components.
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
