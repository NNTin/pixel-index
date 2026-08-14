-- Retire the separate moderator-only 'removed' visibility state (#72). A
-- moderator now reaches the same irreversible outcome an owner does, through
-- the same DELETE endpoint (manage.ts), so 'removed' and 'deleted' meant the
-- same thing under two names. Existing 'removed' rows become 'deleted' before
-- the column is narrowed to the new enum, so no row is left holding a value
-- the new type can't represent.
--
-- The seven `WHERE visibility = 'public'` partial indexes (schema.ts) each
-- pin their predicate to the CURRENT `layout_visibility` type at creation
-- time, so widening the column to `text` first (needed to migrate the data)
-- leaves them comparing `text = layout_visibility` — no such operator.
-- Dropped here and recreated at the end with their current (post-#4/#0004)
-- definitions, once the column is back on the narrowed enum.
DROP INDEX "layouts_public_created_idx";--> statement-breakpoint
DROP INDEX "layouts_public_furniture_idx";--> statement-breakpoint
DROP INDEX "layouts_public_title_idx";--> statement-breakpoint
DROP INDEX "layouts_public_author_idx";--> statement-breakpoint
DROP INDEX "layouts_public_search_idx";--> statement-breakpoint
DROP INDEX "layouts_public_stats_idx";--> statement-breakpoint
DROP INDEX "layouts_public_size_idx";--> statement-breakpoint
ALTER TABLE "layouts" ALTER COLUMN "visibility" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "layouts" ALTER COLUMN "visibility" SET DEFAULT 'public'::text;--> statement-breakpoint
UPDATE "layouts" SET "visibility" = 'deleted' WHERE "visibility" = 'removed';--> statement-breakpoint
DROP TYPE "public"."layout_visibility";--> statement-breakpoint
CREATE TYPE "public"."layout_visibility" AS ENUM('public', 'hidden', 'deleted');--> statement-breakpoint
ALTER TABLE "layouts" ALTER COLUMN "visibility" SET DEFAULT 'public'::"public"."layout_visibility";--> statement-breakpoint
ALTER TABLE "layouts" ALTER COLUMN "visibility" SET DATA TYPE "public"."layout_visibility" USING "visibility"::"public"."layout_visibility";--> statement-breakpoint
CREATE INDEX "layouts_public_created_idx" ON "layouts" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_furniture_idx" ON "layouts" USING btree ("furniture_count" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_title_idx" ON "layouts" USING btree ("title","id") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_author_idx" ON "layouts" USING btree ("author_user_id") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_search_idx" ON "layouts" USING gin ("search_vector") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_stats_idx" ON "layouts" USING btree ("furniture_count","area_count","pet_count") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_size_idx" ON "layouts" USING btree ("cols","rows") WHERE visibility = 'public';
