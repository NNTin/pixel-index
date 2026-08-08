import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div>
      <h1 className="font-display text-2xl text-ink">Not found</h1>
      <p className="mt-2 text-muted">
        There's nothing here.{' '}
        <Link to="/" className="text-accent underline">
          Back to the gallery
        </Link>
        .
      </p>
    </div>
  );
}
