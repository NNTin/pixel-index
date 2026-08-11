#!/usr/bin/env node
/**
 * Entrypoint: boot the dev server, the browser and the HTTP server, and make
 * sure all three come down together.
 *
 * Shutdown matters more here than in most services. Vite is spawned detached so
 * it can be killed as a group, and a missed teardown leaves a browser and a
 * dev server holding memory and a port until the container is killed.
 */

import { PreviewCache } from './cache.js';
import { loadConfig } from './config.js';
import { type DevServer, startDevServer } from './devServer.js';
import { Renderer } from './render.js';
import { buildServer } from './server.js';

export async function main(): Promise<void> {
  const config = loadConfig();

  let devServer: DevServer | undefined;
  let renderer: Renderer | undefined;
  let closing = false;

  const shutdown = async (signal: string, code = 0): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`Received ${signal}, shutting down.`);
    try {
      await app?.close();
    } catch {
      /* already down */
    }
    await renderer?.close();
    devServer?.stop();
    process.exit(code);
  };

  let app: Awaited<ReturnType<typeof buildServer>> | undefined;

  try {
    devServer = await startDevServer(config.upstreamDir);

    renderer = new Renderer({
      devServer,
      concurrency: config.concurrency,
      defaultTimeoutMs: config.timeoutMs,
      ...(config.upstreamDir ? { upstreamDir: config.upstreamDir } : {}),
    });
    await renderer.start();

    const cache = new PreviewCache(config.cacheDir, config.cacheMaxEntries);
    await cache.init();

    app = await buildServer({ config, renderer, cache });
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    console.error('Failed to start:', error);
    await renderer?.close();
    devServer?.stop();
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
  await main();
}
