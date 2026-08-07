import type { ApiError } from '../api/client';

/** A message, never a blank page — see #12's acceptance criteria. */
export function ErrorNotice({ error }: { error: ApiError }) {
  return (
    <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-red-200">
      <p className="font-medium">Couldn't load this.</p>
      <p className="mt-1 text-sm text-red-300">{error.message}</p>
    </div>
  );
}
