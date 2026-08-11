ALTER TYPE "public"."audit_action" ADD VALUE 'layout.rename_slug' BEFORE 'report.create';--> statement-breakpoint
CREATE TABLE "retired_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"layout_id" uuid NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retired_slugs_format" CHECK ("retired_slugs"."slug" ~ '^[a-z0-9][a-z0-9-]*$')
);
--> statement-breakpoint
ALTER TABLE "retired_slugs" ADD CONSTRAINT "retired_slugs_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retired_slugs_layout_idx" ON "retired_slugs" USING btree ("layout_id");