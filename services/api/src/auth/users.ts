/**
 * User upsert on login.
 *
 * Discord username and avatar are cached display data — refreshed on every
 * login and Discord membership checks, allowed to go stale between them.
 * Capability is resolved separately from Discord/config, never granted here.
 */

import { eq } from 'drizzle-orm';

import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import type { DiscordUser } from './discord.js';
import { discordAvatarUrl } from './discord.js';

export async function upsertDiscordUser(
  db: AnyDatabase,
  discordUser: DiscordUser,
): Promise<schema.User> {
  const avatarUrl = discordAvatarUrl(discordUser);

  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUser.id));

  if (existing) {
    const [updated] = await db
      .update(schema.users)
      .set({
        username: discordUser.username,
        globalName: discordUser.globalName ?? null,
        avatarUrl,
        updatedAt: new Date(),
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
      globalName: discordUser.globalName ?? null,
      avatarUrl,
    })
    .returning();
  return created!;
}

/**
 * The fresh row behind an access token's `{id}` claim. `resolveUser`
 * (context.ts) deliberately never does this — it is the stateless-access-token
 * trade-off's whole point — capability.ts and owner routes fetch the complete
 * row because Discord-derived state and attribution do not live in the JWT.
 */
export async function getUserById(db: AnyDatabase, id: string): Promise<schema.User | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user ?? null;
}
