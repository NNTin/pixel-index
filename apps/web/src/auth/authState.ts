import { createContext, useContext } from 'react';

import type { AuthUser } from '../api/types';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** In-memory only (ADR 0001 decision 10; see auth/storage.ts) — null until a session is established. */
  accessToken: string | null;
  login: () => void;
  logout: () => void;
}

/**
 * The context and its hook, apart from the provider component that fills it.
 *
 * Not stylistic: react-refresh only replaces a module in place if everything it
 * exports is a component, so a file exporting both `AuthProvider` and `useAuth`
 * forces a full reload — and a full reload of this app drops the in-memory
 * access token, which means logging in again after every edit.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
