DROP INDEX "layouts_public_created_idx";--> statement-breakpoint
ALTER TABLE "layouts" ADD COLUMN "raw" text NOT NULL;--> statement-breakpoint
CREATE INDEX "layouts_public_furniture_idx" ON "layouts" USING btree ("furniture_count" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_title_idx" ON "layouts" USING btree ("title","id") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_created_idx" ON "layouts" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE visibility = 'public';