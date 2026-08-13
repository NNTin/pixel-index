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
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });

  useEffect(() => {
    // An AbortController where this kept `let cancelled = false`. Two reasons,
    // and the second is why the first is worth having:
    //
    // - `signal.aborted` is honestly `boolean`. A `let` reassigned only in the
    //   *cleanup* narrows to the literal `false` inside the async body, so
    //   `if (cancelled)` reads as dead code to no-unnecessary-condition. The
    //   rule was right about the types and wrong about the program, and the fix
    //   is to stop lying to it rather than to switch it off (#44).
    // - The request actually stops. A flag only suppresses the setState; the
    //   response is still downloaded and parsed for a screen nobody is looking
    //   at, and a superseded one still competes for the connection.
    const controller = new AbortController();
    // Resetting to 'loading' when `deps` change is the whole contract of this
    // hook: without it a screen keeps rendering the previous request's data
    // while the new one is in flight. React's own guidance is to reset with a
    // `key` instead, which a hook cannot do for its caller — so this stays, and
    // the follow-up is a real refactor rather than a lint fix.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading' });
    fetcher(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        // An abort is this hook's own doing, not something to report. client.ts
        // guarantees an aborted request never rejects with an ApiError, so this
        // guard is all that stands between a cancelled request and an error
        // banner for a screen that has moved on.
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          error: error instanceof ApiError ? error : new ApiError(0, 'Something unexpected went wrong.'),
        });
      });
    return () => {
      controller.abort();
    };
    // `deps` is this hook's own parameter — a runtime array the rule cannot
    // analyse, which is the one case where there is nothing to restructure.
    // `fetcher` is deliberately not among them: every caller passes a fresh
    // arrow each render, so depending on it would re-request on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
