import { Link } from 'react-router-dom';

import { apiUrl } from '../api/client';
import type { LayoutSummary } from '../api/types';
import { AuthorLink } from './AuthorLink';
import { factsFor, FactsRow } from './FactsRow';
import { PreviewImage } from './PreviewImage';

export function LayoutCard({ layout }: { layout: LayoutSummary }) {
  return (
    <article className="flex flex-col border-2 border-border bg-surface">
      <Link to={`/layouts/${layout.slug}`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <PreviewImage src={apiUrl(layout.files.thumbnail)} alt={`${layout.title} office layout`} />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h2 className="m-0 font-display text-lg text-ink">
          <Link to={`/layouts/${layout.slug}`} className="hover:text-accent">
            {layout.title}
          </Link>
        </h2>
        <p className="m-0 text-sm text-muted">
          by <AuthorLink author={layout.author} />
        </p>
        {layout.description && <p className="m-0 text-sm text-ink">{layout.description}</p>}
        <FactsRow facts={factsFor(layout)} />
      </div>
    </article>
  );
}
