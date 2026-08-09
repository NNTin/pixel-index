/**
 * Shapes for the bodies tests read, so `response.json()` and `JSON.parse()`
 * stop handing back `any`.
 *
 * `any` in a test is worse than `any` in production code: it does not crash, it
 * silently agrees. `expect(body.nextCursr).toBeTruthy()` on an `any` body is a
 * test that can only fail by accident, and no-unsafe-member-access is what
 * makes that impossible to write.
 */

/** The subset of the published OpenAPI document the contract tests assert on. */
export interface OpenApiDoc {
  openapi: string;
  /** Keyed by route; the value is the per-method object (`get`, `post`, …). */
  paths: Record<string, Record<string, unknown> | undefined>;
  components: { schemas: Record<string, unknown> };
}

/** What the API posts to the renderer service (services/renderer's POST /render). */
export interface RenderRequestBody {
  layout: unknown;
  scale: number;
}

/**
 * The body of a captured `fetch` call, as the string it was sent as.
 *
 * `init.body` is `BodyInit | null`: a Request, a Blob, a stream, a Buffer.
 * `String(...)` over that union quietly produces "[object Object]" for most of
 * them, which is how an assertion about a request body ends up passing against
 * nothing at all — so this insists it really was a string.
 */
function stringBody(init: RequestInit | undefined, what: string): string {
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error(`expected a string ${what} body, got ${typeof body}`);
  }
  return body;
}

/**
 * The render request the API posted to the renderer.
 *
 * The `as` is the one assertion that cannot be avoided: `JSON.parse` returns
 * `any` because JSON genuinely carries no type. Keeping it inside a single
 * named function is the point — the call sites get a checked shape rather than
 * each spreading `any` across its assertions.
 */
export function parseRenderRequest(init: RequestInit | undefined): RenderRequestBody {
  return JSON.parse(stringBody(init, 'render request')) as RenderRequestBody;
}

/**
 * A form-encoded request body — Discord's token endpoint speaks this, not JSON.
 *
 * `URLSearchParams` is accepted as itself rather than round-tripped through a
 * string: `refreshDiscordToken` sends one directly (auth/discord.ts), and it is
 * one of the few BodyInit members whose `toString` actually produces the wire
 * format. Being explicit about that is the point — the two useful cases are
 * handled and everything else is a mistake worth an error.
 */
export function formBody(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body;
  if (body instanceof URLSearchParams) return body;
  return new URLSearchParams(stringBody(init, 'form-encoded request'));
}
