/** Discord-backed membership, submission eligibility, and dashboard capability. */
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';

import type { ApiConfig } from '../config.js';
import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { ApiError } from '../errors.js';
import { requireAuth, type Role } from './context.js';
import {
  discordAvatarUrl,
  DiscordApiError,
  fetchDiscordGuildMember,
} from './discord.js';
import { discardDiscordGrant, usableDiscordAccessToken } from './discordGrant.js';
import { getUserById } from './users.js';

export type SubmissionRestriction =
  | 'discord_membership_required'
  | 'discord_reauthorization_required';

export interface ResolvedCapability {
  user: schema.User;
  submission: { allowed: true; reason: null } | { allowed: false; reason: SubmissionRestriction };
}

const ROLE_RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

function isFresh(user: schema.User, ttlMs: number, now: Date): boolean {
  return (
    user.discordMembershipCheckedAt !== null &&
    now.getTime() - user.discordMembershipCheckedAt.getTime() <= ttlMs
  );
}

function roleForMember(config: ApiConfig, user: schema.User, roleIds: string[]): Role {
  if (user.discordId && config.discordAdminIds.includes(user.discordId)) return 'admin';
  if (config.discordGuild?.moderatorRoleIds.some((id) => roleIds.includes(id))) return 'moderator';
  return 'user';
}

async function updateCachedUser(
  db: AnyDatabase,
  user: schema.User,
  values: Partial<schema.NewUser>,
): Promise<schema.User> {
  const [updated] = await db
    .update(schema.users)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id))
    .returning();
  return updated!;
}

async function reauthorizationRequired(
  db: AnyDatabase,
  user: schema.User,
): Promise<ResolvedCapability> {
  const current = user.role === 'user' ? user : await updateCachedUser(db, user, { role: 'user' });
  return {
    user: current,
    submission: { allowed: false, reason: 'discord_reauthorization_required' },
  };
}

/** Resolve from the short cache, or directly from Discord when it is stale. */
export async function resolveCapability(
  db: AnyDatabase,
  config: ApiConfig,
  user: schema.User,
  options: { now?: Date; force?: boolean } = {},
): Promise<ResolvedCapability> {
  const now = options.now ?? new Date();
  const guild = config.discordGuild;

  if (!guild) {
    const role: Role = user.discordId && config.discordAdminIds.includes(user.discordId) ? 'admin' : 'user';
    const current = user.role === role ? user : await updateCachedUser(db, user, { role });
    return { user: current, submission: { allowed: true, reason: null } };
  }

  if (!options.force && isFresh(user, config.discordMembershipCacheTtlMs, now)) {
    return user.discordGuildMember
      ? { user, submission: { allowed: true, reason: null } }
      : {
          user,
          submission: { allowed: false, reason: 'discord_membership_required' },
        };
  }

  let token;
  try {
    token = await usableDiscordAccessToken(
      db,
      user.id,
      config,
      guild.oauthTokenEncryptionKey,
      { now },
    );
  } catch (error) {
    throw discordUnavailable(error);
  }
  if (token.status === 'reauthorization_required') {
    return reauthorizationRequired(db, user);
  }

  let member: Awaited<ReturnType<typeof fetchDiscordGuildMember>>;
  try {
    member = await fetchDiscordGuildMember(token.accessToken, guild.id);
  } catch (firstError) {
    if (firstError instanceof DiscordApiError && firstError.status === 404) {
      const current = await updateCachedUser(db, user, {
        role: 'user',
        discordGuildMember: false,
        discordMembershipCheckedAt: now,
        guildNickname: null,
      });
      return {
        user: current,
        submission: { allowed: false, reason: 'discord_membership_required' },
      };
    }
    if (firstError instanceof DiscordApiError && firstError.status === 403) {
      await discardDiscordGrant(db, user.id);
      return reauthorizationRequired(db, user);
    }

    // A still-unexpired access token can be invalidated early. Refresh once;
    // invalid/revoked grants become a reconnect result, never "not a member".
    if (firstError instanceof DiscordApiError && firstError.status === 401) {
      let refreshed;
      try {
        refreshed = await usableDiscordAccessToken(
          db,
          user.id,
          config,
          guild.oauthTokenEncryptionKey,
          { forceRefresh: true, now },
        );
      } catch (error) {
        throw discordUnavailable(error);
      }
      if (refreshed.status === 'reauthorization_required') {
        return reauthorizationRequired(db, user);
      }
      try {
        member = await fetchDiscordGuildMember(refreshed.accessToken, guild.id);
      } catch (retryError) {
        if (retryError instanceof DiscordApiError && retryError.status === 404) {
          const current = await updateCachedUser(db, user, {
            role: 'user',
            discordGuildMember: false,
            discordMembershipCheckedAt: now,
            guildNickname: null,
          });
          return {
            user: current,
            submission: { allowed: false, reason: 'discord_membership_required' },
          };
        }
        if (
          retryError instanceof DiscordApiError &&
          (retryError.status === 401 || retryError.status === 403)
        ) {
          await discardDiscordGrant(db, user.id);
          return reauthorizationRequired(db, user);
        }
        throw discordUnavailable(retryError);
      }
    } else {
      throw discordUnavailable(firstError);
    }
  }

  const role = roleForMember(config, user, member.roles);
  const profile = member.user;
  const current = await updateCachedUser(db, user, {
    role,
    discordGuildMember: true,
    discordMembershipCheckedAt: now,
    guildNickname: member.nick,
    ...(profile
      ? {
          username: profile.username,
          globalName: profile.globalName ?? null,
          avatarUrl: discordAvatarUrl(profile),
        }
      : {}),
  });
  return { user: current, submission: { allowed: true, reason: null } };
}

function discordUnavailable(error: unknown): ApiError {
  return new ApiError(
    503,
    'discord_unavailable',
    'Discord membership could not be verified. Please try again shortly.',
  );
}

export async function capabilityForRequest(
  db: AnyDatabase,
  config: ApiConfig,
  request: FastifyRequest,
): Promise<ResolvedCapability> {
  const auth = requireAuth(request);
  const user = await getUserById(db, auth.id);
  if (!user) throw ApiError.unauthorized();
  return resolveCapability(db, config, user);
}

export async function requireSubmissionCapability(
  db: AnyDatabase,
  config: ApiConfig,
  request: FastifyRequest,
): Promise<schema.User> {
  const resolved = await capabilityForRequest(db, config, request);
  if (!resolved.submission.allowed) {
    const reconnect = resolved.submission.reason === 'discord_reauthorization_required';
    throw new ApiError(
      403,
      resolved.submission.reason,
      reconnect
        ? 'Reconnect Discord before changing layouts.'
        : 'Join the configured Discord community before changing layouts.',
    );
  }
  return resolved.user;
}

export async function requireCapability(
  db: AnyDatabase,
  config: ApiConfig,
  request: FastifyRequest,
  atLeast: Role,
): Promise<schema.User> {
  const resolved = await capabilityForRequest(db, config, request);
  // A cached role is useful for display, but it must never authorize a user
  // whose membership cannot currently be established. In particular, a
  // revoked OAuth grant must not leave an old moderator/admin cache usable.
  if (!resolved.submission.allowed) {
    throw ApiError.forbidden('Reconnect Discord and verify guild membership before using this capability.');
  }
  if (ROLE_RANK[resolved.user.role] < ROLE_RANK[atLeast]) {
    throw ApiError.forbidden(`This action requires the ${atLeast} capability.`);
  }
  return resolved.user;
}
