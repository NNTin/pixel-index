/**
 * SQL for reading the append-only `moderation_actions` audit log —
 * `audit.ts`'s `recordModerationAction()` is the only write path; nothing
 * read this back out until now. Admin-only (`auditRoutes.ts`); every layout
 * create/edit/visibility-change/slug-rename/delete, by owner or moderator,
 * lands here with a reason, an actor, and a before/after snapshot.
 */

import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { getLayoutBySlugAnyVisibility } from '../layouts/query.js';

export interface AuditLogFilters {
  /** Exact — resolved against the layout's CURRENT slug, since a slug can be
   *  renamed away from what an old audit row's own before/after mentions
   *  (#29). No match means an empty result, not an error. */
  slug?: string;
  /** Broad search across the current layout's slug/title, for browsing without an exact slug on hand. */
  q?: string;
  action?: schema.ModerationAction['action'];
}

export interface AuditLogRow extends schema.ModerationAction {
  /** Resolved via a LEFT JOIN on `layouts.id = moderation_actions.target_id`
   *  — `target_id` has no FK (schema.ts: history has to outlive whatever it
   *  describes), so this is a best-effort lookup, not a guarantee. Null for
   *  a `user`/`report` target, or a layout id that somehow no longer resolves. */
  layoutSlug: string | null;
  layoutTitle: string | null;
}

export interface ListAuditLogOptions {
  filters: AuditLogFilters;
  limit: number;
  cursor?: string;
}

export interface ListAuditLogResult {
  rows: AuditLogRow[];
  nextCursor: string | null;
}

/**
 * `(createdAt, id)` keyset cursor — the audit log has exactly one natural
 * sort (newest first), unlike `layouts`' multi-sort-key list, so this is a
 * small self-contained pair rather than reusing `layouts/cursor.ts`'s
 * `SortKey`-parameterised codec (that type is layouts-sort-specific; forcing
 * an unrelated tag into it would couple that file to this feature for no
 * reuse benefit).
 */
interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('createdAt' in parsed) || !('id' in parsed)) {
    return null;
  }
  const candidate = parsed as Cursor;
  if (typeof candidate.createdAt !== 'string' || typeof candidate.id !== 'string') return null;
  return candidate;
}

export async function listModerationActions(
  db: AnyDatabase,
  { filters, limit, cursor: cursorParam }: ListAuditLogOptions,
): Promise<ListAuditLogResult> {
  const conditions = [];

  if (filters.slug) {
    const resolved = await getLayoutBySlugAnyVisibility(db, filters.slug);
    // No match: an unsatisfiable condition, so the query below returns
    // nothing rather than the caller having to special-case "not found" —
    // the same not-found-is-empty shape `listLayouts()` already uses.
    conditions.push(
      resolved
        ? and(eq(schema.moderationActions.targetId, resolved.id), eq(schema.moderationActions.targetType, 'layout'))
        : sql`1 = 0`,
    );
  }

  if (filters.q && filters.q.trim() !== '') {
    // `layouts.slug`/`layouts.title` are NULL for any row the join below
    // didn't match (a `user`/`report` target), and `ilike(NULL, …)` is NULL
    // — falsy — so those rows are excluded here without a separate
    // `targetType = 'layout'` check.
    conditions.push(or(ilike(schema.layouts.slug, `%${filters.q}%`), ilike(schema.layouts.title, `%${filters.q}%`)));
  }

  if (filters.action) conditions.push(eq(schema.moderationActions.action, filters.action));

  const cursor = cursorParam ? decodeCursor(cursorParam) : null;
  if (cursor) {
    conditions.push(
      sql`(${schema.moderationActions.createdAt}, ${schema.moderationActions.id}) < (${cursor.createdAt}, ${cursor.id})`,
    );
  }

  const page = await db
    .select({
      id: schema.moderationActions.id,
      actorUserId: schema.moderationActions.actorUserId,
      actorLabel: schema.moderationActions.actorLabel,
      action: schema.moderationActions.action,
      targetType: schema.moderationActions.targetType,
      targetId: schema.moderationActions.targetId,
      reason: schema.moderationActions.reason,
      before: schema.moderationActions.before,
      after: schema.moderationActions.after,
      createdAt: schema.moderationActions.createdAt,
      layoutSlug: schema.layouts.slug,
      layoutTitle: schema.layouts.title,
    })
    .from(schema.moderationActions)
    .leftJoin(
      schema.layouts,
      and(
        eq(schema.layouts.id, schema.moderationActions.targetId),
        eq(schema.moderationActions.targetType, 'layout'),
      ),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.moderationActions.createdAt), desc(schema.moderationActions.id))
    .limit(limit + 1);

  const hasMore = page.length > limit;
  const rows = hasMore ? page.slice(0, limit) : page;
  const lastRow = rows[rows.length - 1];

  const nextCursor =
    hasMore && lastRow ? encodeCursor({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id }) : null;

  return { rows, nextCursor };
}
