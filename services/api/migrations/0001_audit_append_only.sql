-- Make the audit log append-only in the database.
--
-- The requirement is "no update/delete path in application code". A convention
-- like that rots the first time someone writes a cleanup script, and an audit
-- log that can be quietly rewritten is not an audit log. Enforce it where it
-- cannot be bypassed by an ORM call, a psql session or a future maintainer.
--
-- Layouts cascade-delete their reports, but moderation_actions deliberately has
-- no FK to its target: the history has to outlive whatever it describes.

CREATE OR REPLACE FUNCTION moderation_actions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'moderation_actions is append-only: % is not permitted', TG_OP
    USING HINT = 'Record a compensating action instead of editing history.';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER moderation_actions_no_update
  BEFORE UPDATE ON moderation_actions
  FOR EACH ROW EXECUTE FUNCTION moderation_actions_append_only();
--> statement-breakpoint

CREATE TRIGGER moderation_actions_no_delete
  BEFORE DELETE ON moderation_actions
  FOR EACH ROW EXECUTE FUNCTION moderation_actions_append_only();
--> statement-breakpoint

-- TRUNCATE bypasses row-level triggers, so it needs its own statement-level one.
CREATE TRIGGER moderation_actions_no_truncate
  BEFORE TRUNCATE ON moderation_actions
  FOR EACH STATEMENT EXECUTE FUNCTION moderation_actions_append_only();
--> statement-breakpoint

-- Keep updated_at honest without relying on every caller to remember it.
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER layouts_touch_updated_at
  BEFORE UPDATE ON layouts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
