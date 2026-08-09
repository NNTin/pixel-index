/**
 * Reading a stubbed `fetch` call's arguments, honestly.
 *
 * Every suite here replaces `fetch` with `vi.fn(async (input, init) => …)` and
 * routes on the URL. `input` is `RequestInfo | URL` — a string, a `URL`, or a
 * `Request` — and `String(…)` over that union yields `[object Request]` for the
 * last one. A stub that did that would silently take its fallback branch, so
 * the test would keep passing while asserting against a response nobody asked
 * for. Same for `init.body`, which is `BodyInit | null`.
 *
 * These read each form explicitly instead, which is what
 * @typescript-eslint/no-base-to-string is for.
 */

/** The URL a stubbed `fetch` was called with, whatever form it arrived in. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * The request body as the string it was sent as. Throws rather than guessing:
 * every call in these suites sends `JSON.stringify(…)`, and a body that somehow
 * arrived as a stream is a bug in the test, not something to stringify.
 */
export function requestBody(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error(`expected a string request body, got ${typeof body}`);
  }
  return body;
}

/** The request body parsed as JSON, as the shape the caller expects. */
export function requestJson<T>(init: RequestInit | undefined): T {
  return JSON.parse(requestBody(init)) as T;
}
