import { Link } from 'react-router-dom';

import { listLayouts } from '../api/client';
import { useApi } from '../api/useApi';
import { ErrorNotice } from '../components/ErrorNotice';

/**
 * The gallery itself — cards, previews, tags — is #13's scope. This is the
 * shell's proof that the pipeline works end to end: a real call to the #6
 * API, and all three states (#12's acceptance criteria) rendered from it.
 */
export function Home() {
  const state = useApi(() => listLayouts({ limit: 24 }), []);

  if (state.status === 'loading') {
    return <p className="text-slate-400">Loading layouts…</p>;
  }

  if (state.status === 'error') {
    return <ErrorNotice error={state.error} />;
  }

  if (state.data.layouts.length === 0) {
    return <p className="text-slate-400">No layouts published yet.</p>;
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-400">{state.data.total} layouts</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.data.layouts.map((layout) => (
          <li key={layout.slug}>
            <Link
              to={`/layouts/${layout.slug}`}
              className="block rounded-lg border border-slate-800 px-4 py-3 hover:border-slate-600"
            >
              <p className="font-medium">{layout.title}</p>
              <p className="text-sm text-slate-400">by {layout.author.username}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
