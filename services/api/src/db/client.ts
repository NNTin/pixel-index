/**
 * Postgres connection.
 *
 * The connection string is pure configuration — the official index runs a
 * managed Postgres, a self-hoster gets the `postgres` service from
 * docker-compose (#17), and neither is special-cased here.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface CreateDatabaseOptions extends Omit<PoolConfig, 'connectionString'> {
  connectionString?: string;
}

export function resolveConnectionString(explicit?: string): string {
  const url = explicit ?? process.env.DATABASE_URL;
  if (!url) {
    // Fail at boot with something actionable rather than on the first query.
    throw new Error('DATABASE_URL is not set. It is required to reach Postgres.');
  }
  return url;
}

/**
 * Build a pool and a Drizzle handle. Returns the pool too, because whoever
 * created it is responsible for closing it — the API closes it on shutdown, and
 * the migration entrypoint closes it before exiting.
 */
export function createDatabase(options: CreateDatabaseOptions = {}): {
  db: Database;
  pool: Pool;
} {
  const { connectionString, ...poolOptions } = options;
  const pool = new Pool({
    connectionString: resolveConnectionString(connectionString),
    ...poolOptions,
  });
  return { db: drizzle(pool, { schema }), pool };
}
