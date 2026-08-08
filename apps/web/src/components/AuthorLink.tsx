import { Link } from 'react-router-dom';

import type { PublicAuthor } from '../api/types';

/** "clicking an author name filters to their layouts" — #14. Plain text if the author has no id to filter by. */
export function AuthorLink({ author }: { author: PublicAuthor }) {
  if (!author.id) return <>{author.username}</>;
  const params = new URLSearchParams({ author: author.id, authorLabel: author.username });
  return (
    <Link to={`/?${params.toString()}`} className="text-muted hover:text-accent hover:underline" title={`Layouts by ${author.username}`}>
      {author.username}
    </Link>
  );
}
