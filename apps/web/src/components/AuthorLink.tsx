import { Link } from 'react-router-dom';

import type { PublicAuthor } from '../api/types';

/** Linked Discord-backed authors get a dedicated public profile (#23). */
export function AuthorLink({ author }: { author: PublicAuthor }) {
  if (!author.discordId) return <>{author.displayName}</>;
  return (
    <Link to={`/authors/${author.discordId}`} className="text-muted hover:text-accent hover:underline" title={`Layouts by ${author.displayName}`}>
      {author.displayName}
    </Link>
  );
}
