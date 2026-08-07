/**
 * Everything an owner does to their own layout (#9/#15): submit, check a
 * preview before publishing, edit, replace the content, delete, and list
 * what they own. All require an access token — there is no anonymous path
 * through any of these, unlike every function in client.ts.
 */
import { apiRequest, toQueryString } from './client';
import type {
  LayoutDetail,
  ListOwnerLayoutsResponse,
  OwnerLayoutView,
  PatchLayoutBody,
  SubmitLayoutParams,
} from './types';

export interface SubmitResult extends LayoutDetail {
  previewReady: boolean;
}

export function submitLayout(
  raw: string,
  params: SubmitLayoutParams,
  accessToken: string,
): Promise<SubmitResult> {
  return apiRequest(`/api/v1/layouts${toQueryString(params)}`, { method: 'POST', body: raw, accessToken });
}

/** Nothing is persisted — see services/api's own note on this route. Returns a PNG blob to feed an <img> via createObjectURL. */
export function previewCheck(raw: string, accessToken: string): Promise<Blob> {
  return apiRequest('/api/v1/layouts/preview-check', {
    method: 'POST',
    body: raw,
    accessToken,
    parseAs: 'blob',
  });
}

export function getMyLayouts(
  params: { limit?: number; cursor?: string },
  accessToken: string,
): Promise<ListOwnerLayoutsResponse> {
  return apiRequest(`/api/v1/me/layouts${toQueryString(params)}`, { accessToken });
}

export function patchLayout(
  slug: string,
  body: PatchLayoutBody,
  accessToken: string,
): Promise<OwnerLayoutView> {
  return apiRequest(`/api/v1/layouts/${encodeURIComponent(slug)}`, { method: 'PATCH', body, accessToken });
}

export function replaceLayoutContent(
  slug: string,
  raw: string,
  accessToken: string,
): Promise<OwnerLayoutView & { previewReady: boolean }> {
  return apiRequest(`/api/v1/layouts/${encodeURIComponent(slug)}/layout`, {
    method: 'PUT',
    body: raw,
    accessToken,
  });
}

export function deleteLayout(slug: string, accessToken: string): Promise<void> {
  return apiRequest(`/api/v1/layouts/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    accessToken,
    parseAs: 'none',
  });
}
