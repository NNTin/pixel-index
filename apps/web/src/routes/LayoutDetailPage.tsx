import { useParams } from 'react-router-dom';

import { getLayout } from '../api/client';
import { useApi } from '../api/useApi';
import { ErrorNotice } from '../components/ErrorNotice';

/**
 * A minimal proof that deep links work (#12's acceptance criteria: a hard
 * refresh on `/layouts/:slug` must not 404 on GitHub Pages). Preview image,
 * download, full metadata — #13.
 */
export function LayoutDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const state = useApi(() => getLayout(slug!), [slug]);

  if (state.status === 'loading') {
    return <p className="text-slate-400">Loading…</p>;
  }

  if (state.status === 'error') {
    return <ErrorNotice error={state.error} />;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">{state.data.title}</h1>
      <p className="mt-1 text-slate-400">by {state.data.author.username}</p>
      {state.data.description && <p className="mt-4">{state.data.description}</p>}
    </div>
  );
}
