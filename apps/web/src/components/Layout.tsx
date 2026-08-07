import { Link, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

/**
 * "Role-aware navigation — but every check re-enforced server-side; hiding a
 * button is not authorization" (#15's own scope note). Every link this
 * shows is exactly that: a convenience, not a gate — a normal user who
 * guesses `/moderation` still hits the same 403 the API itself would give
 * them, ModerationPage/AdminPage do not trust this any more than the API
 * trusts the access token's role claim for anything that matters.
 */
function Nav() {
  const { status, user, login, logout } = useAuth();

  if (status === 'loading') return null;

  if (status === 'anonymous') {
    return (
      <button
        type="button"
        onClick={login}
        className="border border-slate-700 px-3 py-1.5 text-sm hover:border-slate-500"
      >
        Log in with Discord
      </button>
    );
  }

  return (
    <nav className="flex items-center gap-4 text-sm">
      <Link to="/submit" className="hover:underline">
        Submit
      </Link>
      <Link to="/me/layouts" className="hover:underline">
        My layouts
      </Link>
      {user && (user.role === 'moderator' || user.role === 'admin') && (
        <Link to="/moderation" className="hover:underline">
          Moderation
        </Link>
      )}
      {user?.role === 'admin' && (
        <Link to="/admin" className="hover:underline">
          Admin
        </Link>
      )}
      <span className="text-slate-400">{user?.username}</span>
      <button type="button" onClick={logout} className="border border-slate-700 px-2 py-1 hover:border-slate-500">
        Log out
      </button>
    </nav>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Pixel Index
        </Link>
        <Nav />
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
