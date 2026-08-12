-- `IF NOT EXISTS`, and a defensive `DROP TABLE IF EXISTS` for a table this
-- migration briefly created in an earlier, since-reverted version of this
-- branch: an environment that already applied that version has both
-- `layout.rename_slug` and `retired_slugs` in place, and a plain `ADD VALUE`
-- here would fail with "enum label already exists" on every boot. Idempotent
-- either way — a fresh database with neither yet is unaffected.
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'layout.rename_slug' BEFORE 'report.create';--> statement-breakpoint
DROP TABLE IF EXISTS "retired_slugs";
