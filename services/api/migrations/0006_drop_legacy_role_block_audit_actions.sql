-- Drop the audit_action values from the pre-Discord DB-managed role/block
-- system (user.role_grant, user.role_revoke, user.block, user.unblock).
-- Capability is now resolved from Discord on every request (see
-- migration 0005); nothing writes these actions anymore, and no
-- moderation_actions row uses them.
ALTER TABLE "moderation_actions" ALTER COLUMN "action" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."audit_action";--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('layout.create', 'layout.update', 'layout.replace', 'layout.delete', 'layout.hide', 'layout.unhide', 'layout.remove', 'layout.restore', 'layout.moderate_edit', 'report.create', 'report.resolve', 'report.dismiss');--> statement-breakpoint
ALTER TABLE "moderation_actions" ALTER COLUMN "action" SET DATA TYPE "public"."audit_action" USING "action"::"public"."audit_action";