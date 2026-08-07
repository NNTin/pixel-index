import { Link, useParams } from 'react-router-dom';

import { apiUrl, getLayout, getMeta } from '../api/client';
import { useApi } from '../api/useApi';
import { AuthorLink } from '../components/AuthorLink';
import { ErrorNotice } from '../components/ErrorNotice';
import { factsFor, FactsRow } from '../components/FactsRow';
import { PreviewImage } from '../components/PreviewImage';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function LayoutDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const layoutState = useApi(() => getLayout(slug!), [slug]);
  // Meta is used only for the layoutRevision warning below — its own
  // failure is not this page's failure, so it gets no error branch here.
  const metaState = useApi(() => getMeta(), []);

  if (layoutState.status === 'loading') {
    return <p className="text-slate-400">Loading…</p>;
  }

  if (layoutState.status === 'error') {
    return <ErrorNotice error={layoutState.error} />;
  }

  const layout = layoutState.data;
  const currentPinRevision = metaState.status === 'ready' ? metaState.data.pixelAgents.layoutRevision : null;
  const isAheadOfPin = currentPinRevision !== null && layout.layoutRevision > currentPinRevision;

  return (
    <article>
      <h1 className="text-2xl font-semibold">{layout.title}</h1>
      <p className="mt-1 text-slate-400">
        by <AuthorLink author={layout.author} /> · published{' '}
        {dateFormatter.format(new Date(layout.createdAt))}
      </p>

      <div className="mt-6 max-w-2xl">
        <PreviewImage src={apiUrl(layout.files.preview)} alt={`${layout.title} office layout`} />
      </div>

      {layout.description && <p className="mt-4">{layout.description}</p>}

      <div className="mt-4">
        <FactsRow facts={factsFor(layout)} />
      </div>

      {layout.tags.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {layout.tags.map((tag) => (
            <Link
              key={tag}
              to={`/?tags=${encodeURIComponent(tag)}`}
              className="rounded border border-sky-900 px-2 py-0.5 text-xs text-sky-400 hover:bg-sky-900/30"
            >
              {tag}
            </Link>
          ))}
        </p>
      )}

      {isAheadOfPin && (
        <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/50 px-4 py-3 text-amber-200">
          <p className="font-medium">This layout may not import cleanly.</p>
          <p className="mt-1 text-sm text-amber-300">
            It was made with a newer Pixel Agents (layout revision {layout.layoutRevision}) than this site
            currently validates against (revision {currentPinRevision}). Pixel Agents discards a stored layout
            whose revision is older than yours — if your own install is behind, import may reset it to the
            default office. Update Pixel Agents first if that happens.
          </p>
        </div>
      )}

      <a
        href={apiUrl(layout.files.layout)}
        download={`${layout.slug}.json`}
        className="mt-6 inline-block border-2 border-sky-500 px-4 py-2 text-sky-400 hover:bg-sky-500 hover:text-slate-950"
      >
        Download layout.json
      </a>
      <p className="mt-2 text-sm text-slate-500">
        In Pixel Agents: <strong>Layout → Import</strong>.
      </p>

      <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-400">
        <dt>Pixel Agents version validated against</dt>
        <dd>{layout.pixelAgentsVersion ?? 'unknown'}</dd>
        <dt>Layout revision</dt>
        <dd>{layout.layoutRevision}</dd>
        <dt>Last updated</dt>
        <dd>{dateFormatter.format(new Date(layout.updatedAt))}</dd>
        <dt>SHA-256</dt>
        <dd className="break-all font-mono text-xs">{layout.sha256}</dd>
      </dl>
    </article>
  );
}
