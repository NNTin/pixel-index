import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from './client';
import { useApi } from './useApi';

/** A promise this test resolves by hand, so two requests can be raced deliberately. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Probe({ fetcher, dep }: { fetcher: (signal: AbortSignal) => Promise<string>; dep: string }) {
  const state = useApi(fetcher, [dep]);
  return (
    <p data-testid="state">
      {state.status === 'ready' ? state.data : state.status === 'error' ? `error:${state.error.message}` : 'loading'}
    </p>
  );
}

describe('useApi', () => {
  it('aborts the in-flight request when the component unmounts', async () => {
    // Asserts the mechanism rather than the symptom, deliberately: React 19
    // removed the set-state-after-unmount warning, so "did not set state" has
    // no observable left. The abort is the thing this hook controls.
    let captured: AbortSignal | undefined;
    const view = render(
      <Probe
        dep="a"
        fetcher={(signal) => {
          captured = signal;
          return deferred<string>().promise;
        }}
      />,
    );

    await waitFor(() => expect(captured).toBeDefined());
    expect(captured?.aborted).toBe(false);

    view.unmount();
    expect(captured?.aborted).toBe(true);
  });

  it('lets the newer request win when a slow older one resolves last', async () => {
    // The race this hook exists to lose safely: change a filter, and the
    // response for the filter nobody is looking at any more must not be what
    // ends up on screen.
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = (dep: string) => () => (dep === 'a' ? first.promise : second.promise);

    const view = render(<Probe dep="a" fetcher={fetcher('a')} />);
    view.rerender(<Probe dep="b" fetcher={fetcher('b')} />);

    second.resolve('from b');
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('from b'));

    // The superseded response lands afterwards and must be ignored. Flushed
    // inside act() and past a macrotask on purpose: a bare `await
    // Promise.resolve()` returns before React has had the chance to re-render,
    // so the assertion would pass without the guard it is here to pin.
    first.resolve('from a');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId('state')).toHaveTextContent('from b');
  });

  it('renders no error when a superseded request rejects', async () => {
    // client.ts rejects an aborted request with the abort rather than an
    // ApiError; without the hook's own guard that would still reach setState
    // and paint an error banner over a screen that has moved on.
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = (dep: string) => () => (dep === 'a' ? first.promise : second.promise);

    const view = render(<Probe dep="a" fetcher={fetcher('a')} />);
    view.rerender(<Probe dep="b" fetcher={fetcher('b')} />);

    first.reject(new ApiError(0, 'should never be shown'));
    second.resolve('from b');

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('from b'));
    expect(screen.getByTestId('state')).not.toHaveTextContent('should never be shown');
  });
});
