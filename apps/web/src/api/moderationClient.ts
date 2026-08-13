/** Moderator layout browsing, the Admin read-only user directory, and the admin audit log. */
import { apiRequest, toQueryString } from './client';
import type {
  ListAdminUsersResponse,
  ListAuditLogParams,
  ListAuditLogResponse,
  ListModerationLayoutsParams,
  ListOwnerLayoutsResponse,
  Role,
} from './types';

export function getModerationLayouts(
  params: ListModerationLayoutsParams,
  accessToken: string,
  signal?: AbortSignal,
): Promise<ListOwnerLayoutsResponse> {
  return apiRequest(`/api/v1/moderation/layouts${toQueryString(params)}`, { accessToken, signal });
}

export function getAdminUsers(
  params: { limit?: number; cursor?: string; q?: string; capability?: Role },
  accessToken: string,
  signal?: AbortSignal,
): Promise<ListAdminUsersResponse> {
  return apiRequest(`/api/v1/admin/users${toQueryString(params)}`, { accessToken, signal });
}

export function getAuditLog(
  params: ListAuditLogParams,
  accessToken: string,
  signal?: AbortSignal,
): Promise<ListAuditLogResponse> {
  return apiRequest(`/api/v1/admin/moderation-actions${toQueryString(params)}`, { accessToken, signal });
}
