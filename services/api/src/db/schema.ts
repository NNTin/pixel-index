/**
 * The Pixel Index database schema.
 *
 * Every backend issue after this one is endpoints over these tables, so the
 * decisions that are awkward to change later are made here and explained here:
 *
 * - **Post-moderation.** `visibility` defaults to `public` on insert. There is no
 *   approval queue; the queue is the *report* queue.
 * - **Seed layouts have a real owner.** #18 loads git-versioned layouts that have
 *   no Discord account behind them. Rather than a nullable owner (which would
 *   force every permission check and join to handle null), they belong to a
 *   synthetic system user, with `author_display` carrying the human credit.
 * - **The audit log is append-only in the database**, not by convention. A
 *   trigger rejects UPDATE and DELETE, so "no update/delete path in application
 *   code" cannot rot into "someone added one".
 * - **Stats are denormalised from `@pixel-index/layout-core`.** `layoutStats()`
 *   is the single source of truth and is applied on every write, so a number in
 *   the gallery can never disagree with the layout beside it.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Postgres full-text search vector. Drizzle has no built-in for it. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ── Enums ─────────────────────────────────────────────────────────────────

export const userRole = pgEnum('user_role', ['user', 'moderator', 'admin']);

/**
 * Why four states rather than a boolean:
 *
 * | state     | set by    | reversible | slug reserved | in public API |
 * |-----------|-----------|------------|---------------|---------------|
 * | `public`  | —         | —          | yes           | yes           |
 * | `hidden`  | moderator | yes        | yes           | no            |
 * | `removed` | moderator | no         | yes           | no            |
 * | `deleted` | owner     | no         | yes           | no            |
 *
 * Moderator-hidden and owner-deleted need different behaviour on re-submission:
 * an owner may re-publish something they withdrew, but re-uploading content a
 * moderator removed must not be a way to launder it back onto the front page.
 *
 * The row always survives. Slugs stay reserved because slug reuse by a
 * different author is a quiet impersonation vector, and because the audit log
 * must keep pointing at something.
 */
export const layoutVisibility = pgEnum('layout_visibility', [
  'public',
  'hidden',
  'removed',
  'deleted',
]);

export const reportReason = pgEnum('report_reason', [
  'hate_symbol',
  'harassment',
  'sexual_content',
  'impersonation',
  'spam',
  'other',
]);

export const reportStatus = pgEnum('report_status', ['open', 'resolved', 'dismissed']);

export const auditTargetType = pgEnum('audit_target_type', ['layout', 'user', 'report']);

/**
 * Everything privileged that can happen, including owner actions — #9 requires
 * owner edits in the same log as moderator ones, so a layout's history is
 * reconstructable from this table alone.
 */
export const auditAction = pgEnum('audit_action', [
  'layout.create',
  'layout.update',
  'layout.replace',
  'layout.delete',
  'layout.hide',
  'layout.unhide',
  'layout.remove',
  'layout.restore',
  'layout.moderate_edit',
  'report.create',
  'report.resolve',
  'report.dismiss',
  'user.role_grant',
  'user.role_revoke',
  'user.block',
  'user.unblock',
]);

// ── Tables ────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The identity. Null only for the synthetic system user that owns seed
     * layouts — everything else about a user is cached Discord display data
     * that is allowed to go stale.
     */
    discordId: text('discord_id'),
    username: text('username').notNull(),
    avatarUrl: text('avatar_url'),

    role: userRole('role').notNull().default('user'),

    /** Marks the seed owner. Excluded from user listings; cannot log in. */
    isSystem: boolean('is_system').notNull().default(false),

    /** Author-level block for repeat offenders, so removal is not whack-a-mole. */
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockedReason: text('blocked_reason'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_discord_id_key').on(table.discordId),
    index('users_role_idx').on(table.role),
    // A real account must have a Discord id; only system users may lack one.
    check(
      'users_discord_id_required',
      sql`(${table.isSystem} = true) OR (${table.discordId} IS NOT NULL)`,
    ),
    check('users_system_cannot_login', sql`(${table.isSystem} = false) OR (${table.discordId} IS NULL)`),
  ],
);

export const layouts = pgTable(
  'layouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),

    /**
     * Always set. Seed layouts point at the system user; `authorDisplay` then
     * carries the human credit (the seed layouts are by pablodelucca).
     */
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    authorDisplay: text('author_display'),

    /** Byte-for-byte what Pixel Agents exported. Never reserialised. */
    layout: jsonb('layout').notNull(),
    /** Hash of the stored bytes: submission dedupe (#8) and render cache (#4). */
    sha256: text('sha256').notNull(),

    // ── Denormalised from layoutStats(). See the file header. ──
    cols: integer('cols').notNull(),
    rows: integer('rows').notNull(),
    furnitureCount: integer('furniture_count').notNull().default(0),
    areaCount: integer('area_count').notNull().default(0),
    petCount: integer('pet_count').notNull().default(0),
    carpetCount: integer('carpet_count').notNull().default(0),
    layoutRevision: integer('layout_revision').notNull().default(0),

    /** Which upstream it validated against, so #6 can warn a stale consumer. */
    pixelAgentsVersion: text('pixel_agents_version'),

    visibility: layoutVisibility('visibility').notNull().default('public'),
    /**
     * Why it is not public, surfaced to the owner via /me/layouts (#9). A user
     * whose layout disappeared deserves to know. The authoritative record is
     * still moderation_actions; this is the denormalised current reason.
     */
    visibilityReason: text('visibility_reason'),
    visibilityChangedAt: timestamp('visibility_changed_at', { withTimezone: true }),
    visibilityChangedBy: uuid('visibility_changed_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Generated, so it can never drift from the columns it indexes. */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))`,
    ),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('layouts_slug_key').on(table.slug),
    // Mirrors SLUG_RE in @pixel-index/layout-core. Enforced here too because a
    // bad slug is a permanent, linkable artifact.
    check('layouts_slug_format', sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]*$'`),
    check('layouts_sha256_format', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('layouts_grid_positive', sql`${table.cols} > 0 AND ${table.rows} > 0`),

    // Every public read path filters on visibility first, so the indexes that
    // matter for #6 and #14 are partial. A partial index also stays small as
    // removed and deleted rows accumulate.
    index('layouts_public_created_idx')
      .on(table.createdAt.desc())
      .where(sql`visibility = 'public'`),
    index('layouts_public_author_idx')
      .on(table.authorUserId)
      .where(sql`visibility = 'public'`),
    index('layouts_public_search_idx')
      .using('gin', table.searchVector)
      .where(sql`visibility = 'public'`),
    // #14's numeric range filters: size, furniture density, areas, pets.
    index('layouts_public_stats_idx')
      .on(table.furnitureCount, table.areaCount, table.petCount)
      .where(sql`visibility = 'public'`),
    index('layouts_public_size_idx')
      .on(table.cols, table.rows)
      .where(sql`visibility = 'public'`),

    // Owner dashboards (#9) list hidden rows too, so this one is not partial.
    index('layouts_author_idx').on(table.authorUserId),
    // Submission dedupe (#8) checks this before rendering anything.
    index('layouts_sha256_idx').on(table.sha256),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('tags_name_key').on(table.name),
    // Same vocabulary rule as meta.schema.json's tag pattern.
    check('tags_name_format', sql`${table.name} ~ '^[a-z0-9][a-z0-9-]*$'`),
  ],
);

/** Join table, so filtering by tag is an index scan rather than a JSON scan. */
export const layoutTags = pgTable(
  'layout_tags',
  {
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => layouts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.layoutId, table.tagId] }),
    // The reverse direction: "every layout with this tag".
    index('layout_tags_tag_idx').on(table.tagId, table.layoutId),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    layoutId: uuid('layout_id')
      .notNull()
      .references(() => layouts.id, { onDelete: 'cascade' }),

    /**
     * Null for anonymous reports. #10 decides whether to accept them; the schema
     * supports both so that decision does not need a migration.
     */
    reporterUserId: uuid('reporter_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Lets anonymous reporting be rate-limited without storing an IP address.
     * Hash with a server-side secret, never a bare IP.
     */
    reporterIpHash: text('reporter_ip_hash'),

    reason: reportReason('reason').notNull(),
    detail: text('detail'),

    status: reportStatus('status').notNull().default('open'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),

    createdAt: createdAt(),
  },
  (table) => [
    // The moderator queue: open reports, oldest first.
    index('reports_open_idx')
      .on(table.createdAt)
      .where(sql`status = 'open'`),
    index('reports_layout_idx').on(table.layoutId, table.createdAt.desc()),
    check(
      'reports_resolution_consistent',
      sql`(${table.status} = 'open') = (${table.resolvedAt} IS NULL)`,
    ),
  ],
);

/**
 * Append-only audit log. Enforced by a trigger in migration 0001, not by
 * convention — see the file header.
 *
 * **Neither `targetId` nor `actorUserId` is a foreign key**, and that is
 * deliberate: history has to outlive whatever it describes. A removal that
 * erased its own evidence would defeat the purpose, and — less obviously — an
 * `ON DELETE SET NULL` reference is itself an UPDATE, which the append-only
 * trigger rejects. With a real FK, deleting any user who had ever moderated
 * anything would fail outright.
 *
 * The cost is no referential integrity on either column; `actorLabel` and the
 * `before`/`after` snapshots are what keep a row legible after its subjects are
 * gone. Reconstructing a layout's history means selecting on
 * (targetType='layout', targetId) ordered by createdAt.
 */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Null for actions taken by migrations or the seeder. No FK — see above. */
    actorUserId: uuid('actor_user_id'),
    /** Who it was, in words, so the row survives the account being deleted. */
    actorLabel: text('actor_label'),

    action: auditAction('action').notNull(),
    targetType: auditTargetType('target_type').notNull(),
    targetId: uuid('target_id').notNull(),

    /** Required for every moderator action; #10 rejects a hide without one. */
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),

    createdAt: createdAt(),
  },
  (table) => [
    index('moderation_actions_target_idx').on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    index('moderation_actions_actor_idx').on(table.actorUserId, table.createdAt.desc()),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Layout = typeof layouts.$inferSelect;
export type NewLayout = typeof layouts.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type NewModerationAction = typeof moderationActions.$inferInsert;
