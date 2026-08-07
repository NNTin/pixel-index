#!/bin/sh
# Apply pending migrations, then hand off to the real command (node
# services/api/dist/index.js). This is what makes a self-hoster's first
# `docker compose up` provision a working database with no manual step (see
# migrate.ts) — the migration entrypoint IS the container entrypoint, run
# before every boot, not a one-off job compose has to remember to run.
#
# Migrations are forward-only and idempotent, so running this before every
# start (not just the first) is intended, not wasteful: a restart after a
# deploy that bumped the schema just works.
set -eu

echo "Applying database migrations…"
node services/api/dist/db/migrate.js

exec "$@"
