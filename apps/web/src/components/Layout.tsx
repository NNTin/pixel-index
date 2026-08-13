import { Link, Outlet } from 'react-router-dom';

import { getMeta } from '../api/client';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/authState';
import { useTheme } from '../theme/themeState';
import { CandidatePinBanner } from './CandidatePinBanner';

/**
 * "Role-aware navigation — but every check re-enforced server-side; hiding a
 * button is not authorization" (#15's own scope note). Every link this
 * shows is exactly that: a convenience, not a gate — a normal user who
 * guesses `/moderation` still hits the same 403 the API itself would give
 * them. ModerationPage/AdminPage do not trust this any more than the API:
 * the API revalidates Discord capability for protected actions.
 *
 * The Discord invite is the one link here that is not a convenience over a
 * server-side check — joining the community is the opposite of gated, so it
 * renders for every visitor, logged in or not, whenever one is configured.
 */
function Nav() {
  const { status, user, login, logout } = useAuth();
  const metaState = useApi((signal) => getMeta(signal), []);
  const inviteUrl = metaState.status === 'ready' ? metaState.data.discordInviteUrl : null;

  return (
    <nav className="flex items-center gap-4 text-sm">
      {inviteUrl && (
        <a href={inviteUrl} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">
          Discord
        </a>
      )}
      <Link to="/submit" className="text-ink hover:text-accent">
        Submit
      </Link>
      <Link to="/developer" className="text-ink hover:text-accent">
        Developer
      </Link>
      {status === 'loading' ? null : status === 'anonymous' ? (
        <button
          type="button"
          onClick={login}
          className="border-2 border-border px-3 py-1.5 text-sm text-ink hover:border-accent"
        >
          Log in with Discord
        </button>
      ) : (
        <>
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
          {user?.role === 'admin' && (
            <Link to="/admin/history" className="text-ink hover:text-accent">
              History
            </Link>
          )}
          <span className="text-muted">{user?.displayName}</span>
          <button
            type="button"
            onClick={logout}
            className="border-2 border-border px-2 py-1 text-ink hover:border-accent"
          >
            Log out
          </button>
        </>
      )}
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
      <CandidatePinBanner />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
