CREATE TABLE "discord_oauth_grants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"scopes" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "global_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guild_nickname" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_guild_member" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_membership_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discord_oauth_grants" ADD CONSTRAINT "discord_oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "blocked_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "blocked_reason";
--> statement-breakpoint
-- DB-managed roles are no longer authority. Everyone re-establishes their
-- effective capability through Discord (or DISCORD_ADMIN_IDS in unguilded mode).
UPDATE "users" SET "role" = 'user' WHERE "is_system" = false;
--> statement-breakpoint
-- Associate the four bundled layouts with their real Discord author (#23).
-- An existing row wins on the unique discord_id constraint; otherwise the
-- normal database UUID default creates the same kind of user as OAuth login.
INSERT INTO "users" ("discord_id", "username", "role", "is_system")
VALUES (
  '1528094749993599038',
  'pablodelucca',
  'user',
  false
)
ON CONFLICT ("discord_id") DO NOTHING;
--> statement-breakpoint
UPDATE "layouts"
SET
  "author_user_id" = (
    SELECT "id" FROM "users" WHERE "discord_id" = '1528094749993599038'
  ),
  "author_display" = NULL
WHERE
  "author_user_id" = '00000000-0000-0000-0000-000000000001'
  AND "slug" IN ('blue-office', 'default', 'four-rooms', 'severance-office');
