#!/usr/bin/env node
/**
 * Entrypoint: load config, open the database pool, boot the HTTP server, and
 * make sure both come down together on SIGTERM/SIGINT.
 */

import { createDatabase } from './db/client.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

export async function main(): Promise<void> {
  const config = loadConfig();
  const { db, pool } = createDatabase({ connectionString: config.databaseUrl });

  let closing = false;
  const shutdown = async (signal: string, code = 0): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`Received ${signal}, shutting down.`);
    try {
      await app.close();
    } catch {
      /* already down */
    }
    await pool.end();
    process.exit(code);
  };

  const app = await buildServer({ config, pool, db });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error, 'Failed to start');
    await pool.end();
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (await import('node:path')).resolve(process.argv[1]) ===
    (await import('node:url')).fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}
