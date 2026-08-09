/** Moderator layout browsing and the Admin read-only user directory. */
import { apiRequest, toQueryString } from './client';
import type {
  ListAdminUsersResponse,
  ListModerationLayoutsParams,
  ListOwnerLayoutsResponse,
  Role,
} from './types';

export function getModerationLayouts(
  params: ListModerationLayoutsParams,
  accessToken: string,
): Promise<ListOwnerLayoutsResponse> {
  return apiRequest(`/api/v1/moderation/layouts${toQueryString(params)}`, { accessToken });
}

export function getAdminUsers(
  params: { limit?: number; cursor?: string; q?: string; capability?: Role },
  accessToken: string,
): Promise<ListAdminUsersResponse> {
  return apiRequest(`/api/v1/admin/users${toQueryString(params)}`, { accessToken });
}
