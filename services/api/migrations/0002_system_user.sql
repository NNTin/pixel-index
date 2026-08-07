-- The synthetic owner for seed layouts.
--
-- #18 loads git-versioned layouts that have no Discord account behind them.
-- Giving them a real owner row keeps layouts.author_user_id NOT NULL, so every
-- permission check, join and ownership query has exactly one shape instead of
-- two. Human credit for a seed layout lives in layouts.author_display.
--
-- It is created here rather than by the seeder because the schema depends on it:
-- a fixed id means #18 can reference it without a lookup, and a self-hoster who
-- never runs the seeder still has a consistent database.
--
-- discord_id is NULL, which the users_system_cannot_login check constraint
-- requires of system users — nothing can ever authenticate as this account.

INSERT INTO users (id, discord_id, username, role, is_system)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'pixel-index',
  'user',
  true
)
ON CONFLICT (id) DO NOTHING;
