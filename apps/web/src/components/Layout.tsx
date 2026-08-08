import { Link, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';

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
        className="border-2 border-border px-3 py-1.5 text-sm text-ink hover:border-accent"
      >
        Log in with Discord
      </button>
    );
  }

  return (
    <nav className="flex items-center gap-4 text-sm">
      <Link to="/submit" className="text-ink hover:text-accent">
        Submit
      </Link>
      <Link to="/me/layouts" className="text-ink hover:text-accent">
        My layouts
      </Link>
      {user && (user.role === 'moderator' || user.role === 'admin') && (
        <Link to="/moderation" className="text-ink hover:text-accent">
          Moderation
        </Link>
      )}
      {user?.role === 'admin' && (
        <Link to="/admin" className="text-ink hover:text-accent">
          Admin
        </Link>
      )}
      <span className="text-muted">{user?.username}</span>
      <button type="button" onClick={logout} className="border-2 border-border px-2 py-1 text-ink hover:border-accent">
        Log out
      </button>
    </nav>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="border-2 border-border px-2 py-1 text-sm text-ink hover:border-accent"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="flex items-center justify-between gap-4 border-b-2 border-border px-6 py-4">
        <Link to="/" className="font-display text-xl tracking-tight text-ink">
          Pixel Index
        </Link>
        <div className="flex items-center gap-4">
          <Nav />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
