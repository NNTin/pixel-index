#!/usr/bin/env node
/**
 * Apply pending migrations, then exit.
 *
 * This is the container entrypoint that runs before the API starts, so a
 * self-hoster's first `docker compose up` provisions a working database with no
 * manual step (#17).
 *
 * Migrations are forward-only and idempotent: drizzle's migrator records what it
 * has applied in `drizzle.__drizzle_migrations` and skips those, so running this
 * on every boot is safe and is the intended usage. There is no `down` — rolling
 * back a schema change means writing the next migration.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';

/** Resolves identically from `src/` under tsx and from `dist/` after a build. */
export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

export async function runMigrations(connectionString?: string): Promise<void> {
  const { db, pool } = createDatabase({ connectionString });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

// Only run when executed directly, so importing this for tests is harmless.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied.');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
