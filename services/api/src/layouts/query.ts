/**
 * SQL for the public read paths: list (filtered, sorted, paginated), detail
 * by slug, and the small tag-lookup that decorates both.
 *
 * Kept free of Fastify so it can be tested directly against a database
 * without going through HTTP.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { AnyDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';
import { decodeCursor, encodeCursor, type Cursor, type SortKey } from './cursor.js';

export interface NumericRange {
  min?: number;
  max?: number;
}

export interface ListLayoutsFilters {
  /** users.id — the author to restrict to. */
  author?: string;
  /** Tag names. A layout must have every one of these (AND, not OR). */
  tags?: string[];
  /** Free text over title and description, via the generated search_vector. */
  q?: string;
  cols?: NumericRange;
  rows?: NumericRange;
  furniture?: NumericRange;
  areas?: NumericRange;
  pets?: NumericRange;
}

export interface ListLayoutsOptions {
  filters: ListLayoutsFilters;
  sort: SortKey;
  limit: number;
  /** An opaque cursor from a previous page's `nextCursor`. */
  cursor?: string;
}

export interface ListLayoutsResult {
  rows: schema.Layout[];
  /** Every layout matching `filters`, ignoring pagination — for "N results". */
  total: number;
  nextCursor: string | null;
}

/** The SQL expression each sort key orders by. Shared between filtering, ordering and the cursor. */
function sortExpr(sort: SortKey) {
  switch (sort) {
    case 'newest':
      return schema.layouts.createdAt;
    case 'furniture':
      return schema.layouts.furnitureCount;
    case 'largest':
      // No dedicated index for this one yet — see schema.ts. Fine at current
      // scale; #14 explicitly reserves the right to ask for more indexing
      // "once the UI is real".
      return sql`(${schema.layouts.cols} * ${schema.layouts.rows})`;
    case 'title':
      return schema.layouts.title;
  }
}

function isDescending(sort: SortKey): boolean {
  return sort !== 'title';
}

function buildFilterConditions(filters: ListLayoutsFilters) {
  const conditions = [eq(schema.layouts.visibility, 'public')];

  if (filters.author) conditions.push(eq(schema.layouts.authorUserId, filters.author));

  if (filters.tags && filters.tags.length > 0) {
    // ALL of the requested tags, not any — narrows further with each one
    // added, consistent with how the numeric ranges compose.
    //
    // `= ANY(${array})` looks tempting but is wrong here: drizzle's sql tag
    // expands a plain JS array into "(v1, v2, …)" — parenthesised scalars,
    // not a bound Postgres array literal — and `ANY()` requires a real array
    // on its right side, so this throws "op ANY/ALL (array) requires array on
    // right side" at query time, not at compile time. `IN (…)` built via
    // sql.join is the correct (and correctly parameterised) equivalent.
    const tagList = sql.join(
      filters.tags.map((tag) => sql`${tag}`),
      sql`, `,
    );
    conditions.push(sql`(
      SELECT count(*) FROM ${schema.layoutTags}
      INNER JOIN ${schema.tags} ON ${schema.tags.id} = ${schema.layoutTags.tagId}
      WHERE ${schema.layoutTags.layoutId} = ${schema.layouts.id}
        AND ${schema.tags.name} IN (${tagList})
    ) = ${filters.tags.length}`);
  }

  if (filters.q && filters.q.trim() !== '') {
    conditions.push(
      sql`${schema.layouts.searchVector} @@ plainto_tsquery('english', ${filters.q})`,
    );
  }

  for (const [range, column] of [
    [filters.cols, schema.layouts.cols],
    [filters.rows, schema.layouts.rows],
    [filters.furniture, schema.layouts.furnitureCount],
    [filters.areas, schema.layouts.areaCount],
    [filters.pets, schema.layouts.petCount],
  ] as const) {
    if (range?.min !== undefined) conditions.push(gte(column, range.min));
    if (range?.max !== undefined) conditions.push(lte(column, range.max));
  }

  return conditions;
}

/** `WHERE (sortExpr, id) < (cursor.value, cursor.id)`, direction-aware. */
function cursorCondition(sort: SortKey, cursor: Cursor) {
  const expr = sortExpr(sort);
  const op = isDescending(sort) ? sql`<` : sql`>`;
  return sql`(${expr}, ${schema.layouts.id}) ${op} (${cursor.value}, ${cursor.id})`;
}

export async function listLayouts(
  db: AnyDatabase,
  { filters, sort, limit, cursor: cursorParam }: ListLayoutsOptions,
): Promise<ListLayoutsResult> {
  const conditions = buildFilterConditions(filters);

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.layouts)
    .where(and(...conditions));
  const total = totalRow?.total ?? 0;

  const cursor = cursorParam ? decodeCursor(cursorParam, sort) : null;
  const whereClause = cursor
    ? and(...conditions, cursorCondition(sort, cursor))
    : and(...conditions);

  const expr = sortExpr(sort);
  const orderBy = isDescending(sort)
    ? [desc(expr), desc(schema.layouts.id)]
    : [asc(expr), asc(schema.layouts.id)];

  // One extra row, never returned, just to know whether a next page exists —
  // avoids a second COUNT for that alone.
  const page = await db
    .select()
    .from(schema.layouts)
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(limit + 1);

  const hasMore = page.length > limit;
  const rows = hasMore ? page.slice(0, limit) : page;
  const lastRow = rows[rows.length - 1];

  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({ sort, value: cursorValueOf(sort, lastRow), id: lastRow.id })
      : null;

  return { rows, total, nextCursor };
}

function cursorValueOf(sort: SortKey, row: schema.Layout): string | number {
  switch (sort) {
    case 'newest':
      return row.createdAt.toISOString();
    case 'furniture':
      return row.furnitureCount;
    case 'largest':
      return row.cols * row.rows;
    case 'title':
      return row.title;
  }
}

export async function countPublicLayouts(db: AnyDatabase): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.layouts)
    .where(eq(schema.layouts.visibility, 'public'));
  return row?.total ?? 0;
}

export async function getLayoutBySlug(db: AnyDatabase, slug: string): Promise<schema.Layout | null> {
  const [row] = await db
    .select()
    .from(schema.layouts)
    .where(and(eq(schema.layouts.slug, slug), eq(schema.layouts.visibility, 'public')));
  return row ?? null;
}

/** Tag names for a set of layouts, grouped by layout id. Empty array for a layout with none. */
export async function tagsForLayouts(
  db: AnyDatabase,
  layoutIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(layoutIds.map((id) => [id, []]));
  if (layoutIds.length === 0) return map;

  const rows = await db
    .select({ layoutId: schema.layoutTags.layoutId, name: schema.tags.name })
    .from(schema.layoutTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.layoutTags.tagId))
    .where(inArray(schema.layoutTags.layoutId, layoutIds));

  for (const row of rows) map.get(row.layoutId)?.push(row.name);
  return map;
}

export async function authorForLayout(
  db: AnyDatabase,
  authorUserId: string,
): Promise<schema.User | null> {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, authorUserId));
  return row ?? null;
}

export async function authorsForLayouts(
  db: AnyDatabase,
  authorUserIds: string[],
): Promise<Map<string, schema.User>> {
  if (authorUserIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.id, [...new Set(authorUserIds)]));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * By content hash, **regardless of visibility** — dedupe (#8) has to catch a
 * resubmission of something a moderator already removed, not just a public
 * one, or a moderation decision could be silently laundered back onto the
 * front page by re-uploading byte-identical content under a fresh slug.
 */
export async function findLayoutBySha256(
  db: AnyDatabase,
  sha256: string,
): Promise<schema.Layout | null> {
  const [row] = await db.select().from(schema.layouts).where(eq(schema.layouts.sha256, sha256));
  return row ?? null;
}

/** For the per-user daily submission cap (#8). */
export async function countUserSubmissionsSince(
  db: AnyDatabase,
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.layouts)
    .where(and(eq(schema.layouts.authorUserId, userId), gte(schema.layouts.createdAt, since)));
  return row?.total ?? 0;
}

/**
 * Create-or-reuse each tag by name, then attach every one to the layout.
 * Tag names are validated by the caller (layout-core's `SLUG_RE`, the same
 * pattern `tags_name_format` enforces) before this ever runs.
 */
export async function attachTags(
  db: AnyDatabase,
  layoutId: string,
  tagNames: string[],
): Promise<void> {
  if (tagNames.length === 0) return;

  const unique = [...new Set(tagNames)];
  const existing = await db.select().from(schema.tags).where(inArray(schema.tags.name, unique));
  const existingNames = new Set(existing.map((tag) => tag.name));
  const toCreate = unique.filter((name) => !existingNames.has(name));

  const created =
    toCreate.length > 0
      ? await db
          .insert(schema.tags)
          .values(toCreate.map((name) => ({ name })))
          .returning()
      : [];

  const allTags = [...existing, ...created];
  await db.insert(schema.layoutTags).values(allTags.map((tag) => ({ layoutId, tagId: tag.id })));
}
