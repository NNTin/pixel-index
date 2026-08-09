import type { ReactNode } from 'react';

import type { Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';

const ROLE_RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

/**
 * A client-side gate is UX only — "hiding a button is not authorization"
 * (#15). The real enforcement is the API rejecting the request; this exists
 * so a logged-out visitor sees "log in to do this" instead of a page that
 * silently fails, and a normal user sees "moderators only" instead of a
 * console that renders empty because every request it makes 403s.
 */
export function RequireAuth({
  role,
  children,
}: {
  // `| undefined` spelled out so callers may pass a maybe-undefined role: for
  // a React prop, absent and explicitly undefined mean the same thing.
  role?: Role | undefined;
  children: ReactNode;
}) {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return <p className="text-muted">Loading…</p>;
  }

  if (status === 'anonymous') {
    return <p className="text-muted">Log in with Discord to use this page.</p>;
  }

  if (role && (!user || ROLE_RANK[user.role] < ROLE_RANK[role])) {
    return <p className="text-muted">This page is for {role}s only.</p>;
  }

  return <>{children}</>;
}
