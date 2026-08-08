#!/bin/sh
# Apply pending migrations, seed if the database is empty, then hand off to
# the real command (node services/api/dist/index.js). This is what makes a
# self-hoster's first `docker compose up` provision a working, populated
# database with no manual step (see migrate.ts, seed.ts) — this entrypoint
# runs before every boot, not a one-off job compose has to remember to run.
#
# Both steps are idempotent, so running them before every start (not just
# the first) is intended, not wasteful: a restart after a deploy that bumped
# the schema just works, and seeding is a silent no-op once any layout
# exists — seeded or not.
set -eu

echo "Applying database migrations…"
node services/api/dist/db/migrate.js

echo "Seeding starter layouts if the database is empty…"
node services/api/dist/db/seed.js

exec "$@"
