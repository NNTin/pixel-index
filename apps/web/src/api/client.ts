/**
 * A thin fetch wrapper for the public layout API (#6), extended for
 * authenticated calls (#15). No hostname lives here or anywhere else in
 * this app — `VITE_API_BASE_URL` is build-time config with a documented
 * local-dev default (see `.env.example`), so a self-hoster's deployment
 * never has to grep the source for a hardcoded domain and replace it with
 * their own.
 */
import type {
  LayoutDetail,
  ListLayoutsParams,
  ListLayoutsResponse,
  ListTagsResponse,
  MetaResponse,
  PublicAuthorResponse,
} from './types';

// `||`, not `??`: an unset GitHub Actions repo variable interpolates to an
// empty string, not undefined, and an empty base URL would silently turn
// every request into a same-origin call against the Pages domain itself —
// a confusing 404 instead of the clear "unreachable" message this is meant
// to produce.
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  /** Populated for a 422 from layout-core validation (submit, replace, preview-check) — field/furniture-id-naming issues, not just a generic message. */
  readonly issues: ValidationIssue[] | null;

  constructor(status: number, message: string, issues: ValidationIssue[] | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

export interface RequestOptions {
  method?: string;
  /** A string sends as-is (used where byte-exact JSON matters — submit, replace). An object is JSON.stringify'd. */
  body?: string | object;
  accessToken?: string;
  headers?: Record<string, string>;
  /** Set for endpoints that return bytes (preview-check) rather than JSON. */
  parseAs?: 'json' | 'blob' | 'text' | 'none';
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, accessToken, headers = {}, parseAs = 'json' } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
  } catch {
    // A network failure (API down, CORS misconfigured, offline) throws
    // TypeError, not something with a status — normalized here so every
    // caller has one error shape to render a message from, per #12's
    // "degrades legibly" acceptance criterion.
    throw new ApiError(0, 'Could not reach the API. It may be down, or unreachable from here.');
  }

  if (!response.ok) {
    // The API's error envelope (errors.ts) is always { error, message } and,
    // for a 422, { issues: [...] } too — surfacing the real message (a
    // required reason, a rejected furniture id, a rate limit) is the whole
    // difference between an actionable form error and "The API returned
    // 422", per #15's own acceptance criteria.
    let message = `The API returned ${response.status} for ${path}.`;
    let issues: ValidationIssue[] | null = null;
    try {
      const errorBody = (await response.json()) as { message?: string; issues?: ValidationIssue[] };
      if (errorBody.message) message = errorBody.message;
      if (errorBody.issues) issues = errorBody.issues;
    } catch {
      /* not JSON — keep the generic message */
    }
    throw new ApiError(response.status, message, issues);
  }

  if (parseAs === 'none') return undefined as T;
  if (parseAs === 'blob') return (await response.blob()) as T;
  if (parseAs === 'text') return (await response.text()) as T;
  return (await response.json()) as T;
}

function toQueryString<T extends object>(params: T): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined) as [string, string | number][];
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}

export function listLayouts(params: ListLayoutsParams = {}): Promise<ListLayoutsResponse> {
  return apiRequest(`/api/v1/layouts${toQueryString(params)}`);
}

export function getLayout(slug: string): Promise<LayoutDetail> {
  return apiRequest(`/api/v1/layouts/${encodeURIComponent(slug)}`);
}

export function getAuthor(id: string): Promise<PublicAuthorResponse> {
  return apiRequest(`/api/v1/authors/${encodeURIComponent(id)}`);
}

/** Exact uploaded layout.json text; callers may format it for presentation. */
export function getLayoutJson(slug: string): Promise<string> {
  return apiRequest(`/api/v1/layouts/${encodeURIComponent(slug)}/download`, { parseAs: 'text' });
}

export function getMeta(): Promise<MetaResponse> {
  return apiRequest('/api/v1/meta');
}

export function listTags(): Promise<ListTagsResponse> {
  return apiRequest('/api/v1/tags');
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

export { API_BASE_URL, apiRequest, toQueryString };
