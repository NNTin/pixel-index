import { Link } from 'react-router-dom';

import { usePreviewImage } from '../api/previewSourceState';
import type { LayoutSummary } from '../api/types';
import { AuthorLink } from './AuthorLink';
import { factsFor } from './facts';
import { FactsRow } from './FactsRow';
import { PreviewImage } from './PreviewImage';

export function LayoutCard({ layout }: { layout: LayoutSummary }) {
  const preview = usePreviewImage(layout.slug, layout.files.thumbnail);

  return (
    <article className="flex flex-col border-2 border-border bg-surface">
      <Link to={`/layouts/${layout.slug}`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <PreviewImage {...preview} alt={`${layout.title} office layout`} />
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
