import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is a *development* tool: it turns `src/db/schema.ts` into the SQL
 * files under `migrations/`. It never runs in production — the container applies
 * the generated SQL with drizzle-orm's migrator (`src/db/migrate.ts`), so
 * drizzle-kit is not installed in the runtime image.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/pixel_index',
  },
});
