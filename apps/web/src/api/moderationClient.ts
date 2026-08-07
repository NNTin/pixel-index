/**
 * The moderation console and admin console (#15): browsing every layout
 * regardless of visibility, acting on one (shares `patchLayout` from
 * manageClient.ts — #10 never built a separate moderator endpoint, see its
 * comment thread), and account role/block actions.
 */
import { apiRequest, toQueryString } from './client';
import type { ListModerationLayoutsParams, ListOwnerLayoutsResponse, PublicUserView, Role } from './types';

export function getModerationLayouts(
  params: ListModerationLayoutsParams,
  accessToken: string,
): Promise<ListOwnerLayoutsResponse> {
  return apiRequest(`/api/v1/moderation/layouts${toQueryString(params)}`, { accessToken });
}

export function searchUsers(q: string, accessToken: string): Promise<{ users: PublicUserView[] }> {
  return apiRequest(`/api/v1/users${toQueryString({ q })}`, { accessToken });
}

export function patchUserRole(id: string, role: Role, accessToken: string): Promise<PublicUserView> {
  return apiRequest(`/api/v1/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    body: { role },
    accessToken,
  });
}

export function patchUserBlock(
  id: string,
  body: { blocked: boolean; reason?: string },
  accessToken: string,
): Promise<PublicUserView> {
  return apiRequest(`/api/v1/users/${encodeURIComponent(id)}/block`, { method: 'PATCH', body, accessToken });
}
