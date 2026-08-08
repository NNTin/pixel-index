import type { ApiError } from '../api/client';

/** A message, never a blank page — see #12's acceptance criteria. */
export function ErrorNotice({ error }: { error: ApiError }) {
  return (
    <div className="rounded-lg border-2 border-danger bg-danger-soft px-4 py-3 text-danger">
      <p className="font-medium">Couldn't load this.</p>
      <p className="mt-1 text-sm text-danger">{error.message}</p>
    </div>
  );
}
