/**
 * A thin fetch wrapper for the public layout API (#6). No hostname lives
 * here or anywhere else in this app — `VITE_API_BASE_URL` is build-time
 * config with a documented local-dev default (see `.env.example`), so a
 * self-hoster's deployment never has to grep the source for a hardcoded
 * domain and replace it with their own.
 */
import type {
  LayoutDetail,
  ListLayoutsParams,
  ListLayoutsResponse,
  ListTagsResponse,
  MetaResponse,
} from './types';

// `||`, not `??`: an unset GitHub Actions repo variable interpolates to an
// empty string, not undefined, and an empty base URL would silently turn
// every request into a same-origin call against the Pages domain itself —
// a confusing 404 instead of the clear "unreachable" message this is meant
// to produce.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`);
  } catch (cause) {
    // A network failure (API down, CORS misconfigured, offline) throws
    // TypeError, not something with a status — normalized here so every
    // caller has one error shape to render a message from, per #12's
    // "degrades legibly" acceptance criterion.
    throw new ApiError(0, 'Could not reach the API. It may be down, or unreachable from here.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, `The API returned ${response.status} for ${path}.`);
  }

  return (await response.json()) as T;
}

function toQueryString(params: ListLayoutsParams): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined) as [string, string | number][];
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}

export function listLayouts(params: ListLayoutsParams = {}): Promise<ListLayoutsResponse> {
  return request(`/api/v1/layouts${toQueryString(params)}`);
}

export function getLayout(slug: string): Promise<LayoutDetail> {
  return request(`/api/v1/layouts/${encodeURIComponent(slug)}`);
}

export function getMeta(): Promise<MetaResponse> {
  return request('/api/v1/meta');
}

export function listTags(): Promise<ListTagsResponse> {
  return request('/api/v1/tags');
}

/**
 * `LayoutSummary.files` (preview/thumbnail/layout) are API-relative paths,
 * not full URLs — the API doesn't know its own public origin at response
 * time (self-hosters run it behind arbitrary hostnames). This is the one
 * place that turns one into something an `<img src>` or `<a href>` can use.
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export { API_BASE_URL };
