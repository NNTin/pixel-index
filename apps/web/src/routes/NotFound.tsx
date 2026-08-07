import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-slate-400">
        There's nothing here.{' '}
        <Link to="/" className="underline">
          Back to the gallery
        </Link>
        .
      </p>
    </div>
  );
}
