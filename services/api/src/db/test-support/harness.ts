/**
 * A real Postgres for tests, in-process.
 *
 * PGlite is Postgres compiled to WASM, so migrations run against the actual
 * engine — triggers, generated tsvector columns, partial indexes, enums and
 * check constraints all behave as they will in production. A mocked database
 * would prove none of that, and every acceptance criterion for this schema is
 * about behaviour the engine provides.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { MIGRATIONS_FOLDER } from '../migrate.js';
import * as schema from '../schema.js';

export type TestDatabase = PgliteDatabase<typeof schema> & { $client: PGlite };

export interface Harness {
  db: TestDatabase;
  client: PGlite;
  close: () => Promise<void>;
}

/** A fresh, empty database with every migration applied. */
export async function createTestDatabase(): Promise<Harness> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as TestDatabase;
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}

/** Apply migrations again on an existing database, to prove idempotence. */
export async function migrateAgain(harness: Harness): Promise<void> {
  await migrate(harness.db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export async function tableNames(client: PGlite): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}
