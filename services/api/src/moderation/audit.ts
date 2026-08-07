/**
 * One place that writes to `moderation_actions`, so every privileged write —
 * an owner editing their own layout, a moderator hiding someone else's, an
 * admin granting a role — ends up in the same append-only history in the
 * same shape. The table itself refuses `UPDATE`/`DELETE` at the database
 * level (schema.ts migration 0001); this just owns the `INSERT` shape.
 */

import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';

export interface RecordActionInput {
  actorUserId: string;
  actorLabel: string;
  action: schema.ModerationAction['action'];
  targetType: schema.ModerationAction['targetType'];
  targetId: string;
  /** Required for a moderator/admin action; absent for an owner acting on their own. */
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function recordModerationAction(
  db: AnyDatabase,
  input: RecordActionInput,
): Promise<void> {
  await db.insert(schema.moderationActions).values({
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
  });
}
