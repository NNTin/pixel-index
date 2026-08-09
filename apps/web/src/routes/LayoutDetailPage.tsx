import { Link, useParams } from 'react-router-dom';

import { getLayout, getLayoutJson, getMeta } from '../api/client';
import { previewImageProps, usePreviewSource } from '../api/PreviewSourceContext';
import { useApi } from '../api/useApi';
import { AuthorLink } from '../components/AuthorLink';
import { ErrorNotice } from '../components/ErrorNotice';
import { factsFor, FactsRow } from '../components/FactsRow';
import { LayoutJsonPanel, type LayoutJsonState } from '../components/LayoutJsonPanel';
import { LiveOfficePreview } from '../components/LiveOfficePreview';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function LayoutDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const layoutState = useApi(() => getLayout(slug!), [slug]);
  const layoutJsonState = useApi(() => getLayoutJson(slug!), [slug]);
  // Meta is used only for the layoutRevision warning below — its own
  // failure is not this page's failure, so it gets no error branch here.
  const metaState = useApi(() => getMeta(), []);
  // Read before the early returns below — hooks cannot be called conditionally,
  // and resolving the URL needs `layout.files`, which only exists after them.
  const previewSource = usePreviewSource();

  if (layoutState.status === 'loading') {
    return <p className="text-muted">Loading…</p>;
  }

  if (layoutState.status === 'error') {
    return <ErrorNotice error={layoutState.error} />;
  }

  const layout = layoutState.data;
  const currentPinRevision = metaState.status === 'ready' ? metaState.data.pixelAgents.layoutRevision : null;
  const isAheadOfPin = currentPinRevision !== null && layout.layoutRevision > currentPinRevision;
  const jsonState: LayoutJsonState =
    layoutJsonState.status === 'ready'
      ? { status: 'ready', source: layoutJsonState.data }
      : layoutJsonState.status === 'error'
        ? { status: 'error', message: layoutJsonState.error.message }
        : { status: 'loading' };

  return (
    <article>
      <h1 className="font-display text-2xl text-ink">{layout.title}</h1>
      <p className="mt-1 text-muted">
        by <AuthorLink author={layout.author} /> · published{' '}
        {dateFormatter.format(new Date(layout.createdAt))}
      </p>

      <div className="max-w-3xl">
        <LiveOfficePreview
          layout={layout}
          staticPreview={previewImageProps(previewSource, layout.slug, layout.files.thumbnail)}
        />
      </div>

      {layout.description && <p className="mt-4 text-ink">{layout.description}</p>}

      <div className="mt-4">
        <FactsRow facts={factsFor(layout)} />
      </div>

      {layout.tags.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {layout.tags.map((tag) => (
            <Link
              key={tag}
              to={`/?tags=${encodeURIComponent(tag)}`}
              className="rounded border border-accent/40 px-2 py-0.5 text-xs text-accent hover:bg-accent-soft"
            >
              {tag}
            </Link>
          ))}
        </p>
      )}

      {isAheadOfPin && (
        <div className="mt-4 rounded-lg border-2 border-warning bg-warning-soft px-4 py-3 text-warning">
          <p className="font-medium">This layout may not import cleanly.</p>
          <p className="mt-1 text-sm text-warning">
            It was made with a newer Pixel Agents (layout revision {layout.layoutRevision}) than this site
            currently validates against (revision {currentPinRevision}). Pixel Agents discards a stored layout
            whose revision is older than yours — if your own install is behind, import may reset it to the
            default office. Update Pixel Agents first if that happens.
          </p>
        </div>
      )}

      <LayoutJsonPanel
        state={jsonState}
        slug={layout.slug}
        downloadPath={layout.files.layout}
      />
      <p className="mt-2 text-sm text-subtle">
        In Pixel Agents: <strong>Layout → Import</strong>.
      </p>

      <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-muted">
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
