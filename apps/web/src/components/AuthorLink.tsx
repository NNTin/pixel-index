import { Link } from 'react-router-dom';

import type { PublicAuthor } from '../api/types';

/** Linked Discord-backed authors get a dedicated public profile (#23). */
export function AuthorLink({ author }: { author: PublicAuthor }) {
  if (!author.id) return <>{author.displayName}</>;
  return (
    <Link to={`/authors/${author.id}`} className="text-muted hover:text-accent hover:underline" title={`Layouts by ${author.displayName}`}>
      {author.displayName}
    </Link>
  );
}
