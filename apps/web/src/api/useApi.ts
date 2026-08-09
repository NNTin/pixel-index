import { useEffect, useState } from 'react';

import { ApiError } from './client';

export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; data: T };

/**
 * Loading/error/ready as data, not booleans a component has to combine
 * itself — #12's "degrades legibly when the API is unreachable" acceptance
 * criterion means every screen that calls the API needs an explicit error
 * branch, and this is the one place that branch gets built.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // Resetting to 'loading' when `deps` change is the whole contract of this
    // hook: without it a screen keeps rendering the previous request's data
    // while the new one is in flight. React's own guidance is to reset with a
    // `key` instead, which a hook cannot do for its caller — so this stays, and
    // the follow-up is a real refactor rather than a lint fix.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading' });
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          error: error instanceof ApiError ? error : new ApiError(0, 'Something unexpected went wrong.'),
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
