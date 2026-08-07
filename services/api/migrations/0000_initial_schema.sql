CREATE TYPE "public"."audit_action" AS ENUM('layout.create', 'layout.update', 'layout.replace', 'layout.delete', 'layout.hide', 'layout.unhide', 'layout.remove', 'layout.restore', 'layout.moderate_edit', 'report.create', 'report.resolve', 'report.dismiss', 'user.role_grant', 'user.role_revoke', 'user.block', 'user.unblock');--> statement-breakpoint
CREATE TYPE "public"."audit_target_type" AS ENUM('layout', 'user', 'report');--> statement-breakpoint
CREATE TYPE "public"."layout_visibility" AS ENUM('public', 'hidden', 'removed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('hate_symbol', 'harassment', 'sexual_content', 'impersonation', 'spam', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
CREATE TABLE "layout_tags" (
	"layout_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "layout_tags_layout_id_tag_id_pk" PRIMARY KEY("layout_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_display" text,
	"layout" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"cols" integer NOT NULL,
	"rows" integer NOT NULL,
	"furniture_count" integer DEFAULT 0 NOT NULL,
	"area_count" integer DEFAULT 0 NOT NULL,
	"pet_count" integer DEFAULT 0 NOT NULL,
	"carpet_count" integer DEFAULT 0 NOT NULL,
	"layout_revision" integer DEFAULT 0 NOT NULL,
	"pixel_agents_version" text,
	"visibility" "layout_visibility" DEFAULT 'public' NOT NULL,
	"visibility_reason" text,
	"visibility_changed_at" timestamp with time zone,
	"visibility_changed_by" uuid,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layouts_slug_format" CHECK ("layouts"."slug" ~ '^[a-z0-9][a-z0-9-]*$'),
	CONSTRAINT "layouts_sha256_format" CHECK ("layouts"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "layouts_grid_positive" CHECK ("layouts"."cols" > 0 AND "layouts"."rows" > 0)
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"action" "audit_action" NOT NULL,
	"target_type" "audit_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layout_id" uuid NOT NULL,
	"reporter_user_id" uuid,
	"reporter_ip_hash" text,
	"reason" "report_reason" NOT NULL,
	"detail" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_resolution_consistent" CHECK (("reports"."status" = 'open') = ("reports"."resolved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_format" CHECK ("tags"."name" ~ '^[a-z0-9][a-z0-9-]*$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text,
	"username" text NOT NULL,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_discord_id_required" CHECK (("users"."is_system" = true) OR ("users"."discord_id" IS NOT NULL)),
	CONSTRAINT "users_system_cannot_login" CHECK (("users"."is_system" = false) OR ("users"."discord_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "layout_tags" ADD CONSTRAINT "layout_tags_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_tags" ADD CONSTRAINT "layout_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_visibility_changed_by_users_id_fk" FOREIGN KEY ("visibility_changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layout_tags_tag_idx" ON "layout_tags" USING btree ("tag_id","layout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "layouts_slug_key" ON "layouts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "layouts_public_created_idx" ON "layouts" USING btree ("created_at" DESC NULLS LAST) WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_author_idx" ON "layouts" USING btree ("author_user_id") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_search_idx" ON "layouts" USING gin ("search_vector") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_stats_idx" ON "layouts" USING btree ("furniture_count","area_count","pet_count") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_public_size_idx" ON "layouts" USING btree ("cols","rows") WHERE visibility = 'public';--> statement-breakpoint
CREATE INDEX "layouts_author_idx" ON "layouts" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "layouts_sha256_idx" ON "layouts" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_actor_idx" ON "moderation_actions" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_open_idx" ON "reports" USING btree ("created_at") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "reports_layout_idx" ON "reports" USING btree ("layout_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_key" ON "tags" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_discord_id_key" ON "users" USING btree ("discord_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");