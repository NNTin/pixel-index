/**
 * User upsert on login, and the first-admin bootstrap.
 *
 * Discord username and avatar are cached display data — refreshed on every
 * login, allowed to go stale between them. Role is never downgraded by
 * login; the only role change login ever makes is promoting a configured
 * bootstrap admin.
 */

import { eq } from 'drizzle-orm';

import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import type { DiscordUser } from './discord.js';
import { discordAvatarUrl } from './discord.js';

export interface UpsertDiscordUserOptions {
  /**
   * A self-hoster's own Discord id, promoted to `admin` on every login of
   * that account — the documented, no-SQL way to bootstrap the first admin.
   * See README "Bootstrapping the first admin".
   */
  initialAdminDiscordId?: string;
}

export async function upsertDiscordUser(
  db: AnyDatabase,
  discordUser: DiscordUser,
  options: UpsertDiscordUserOptions = {},
): Promise<schema.User> {
  const avatarUrl = discordAvatarUrl(discordUser);
  const isBootstrapAdmin = options.initialAdminDiscordId === discordUser.id;

  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUser.id));

  if (existing) {
    const [updated] = await db
      .update(schema.users)
      .set({
        username: discordUser.username,
        avatarUrl,
        // Only ever promotes. A bootstrap admin who was demoted by another
        // admin stays demoted unless they are still the configured id.
        ...(isBootstrapAdmin && existing.role !== 'admin' ? { role: 'admin' as const } : {}),
      })
      .where(eq(schema.users.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(schema.users)
    .values({
      discordId: discordUser.id,
      username: discordUser.username,
      avatarUrl,
      role: isBootstrapAdmin ? 'admin' : 'user',
    })
    .returning();
  return created!;
}

/**
 * The fresh row behind an access token's `{id, role}` claims. `resolveUser`
 * (context.ts) deliberately never does this — it is the stateless-access-token
 * trade-off's whole point — but #8's submission route needs `blockedAt`, which
 * the token cannot carry (it would be exactly as stale as `role` already is),
 * and the full row's `id` for `authorUserId` regardless.
 */
export async function getUserById(db: AnyDatabase, id: string): Promise<schema.User | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user ?? null;
}
