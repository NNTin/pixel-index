/**
 * The pinned upstream's Vite dev server.
 *
 * The renderer draws previews with Pixel Agents' *own* renderer rather than
 * reimplementing it, which means running upstream's webview. Its dev-mode
 * "browser mock" decodes the bundled assets in-page and feeds them to the app
 * over the same message path the real server uses — so wall autotiling, carpet
 * marching-squares, per-tile colorize and z-sorting are all upstream's.
 *
 * Started once at boot and shared by every render: booting Vite takes seconds,
 * and doing it per request would make the service useless.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

import { resolveUpstreamDir } from '@pixel-index/layout-core';

// 120s was too tight for a cold GitHub Actions runner — no vite cache, no
// npm cache warm from a prior run, first-ever esbuild dep pre-bundle of the
// whole webview-ui. Found live: this job never got far enough to hit this
// path before #18 (it always failed earlier, on the v1 pipeline's own
// missing dist/), so the real cold-start cost was never measured until now.
// Kept below vitest.integration.config.ts's hookTimeout so this timeout's
// own (more informative) error fires first, instead of vitest's generic
// "Hook timed out" with none of the child process's captured output.
const DEV_STARTUP_TIMEOUT_MS = 200_000;

export interface DevServer {
  url: string;
  stop: () => void;
}

/**
 * The environment Vite is spawned with.
 *
 * `NODE_ENV` is forced to `development`, and that is not cosmetic. Vite derives
 * `import.meta.env.DEV` from NODE_ENV even when running the dev server, and
 * upstream gates its entire browser mock on `import.meta.env.DEV`
 * (webview-ui/src/main.tsx). Under `NODE_ENV=production` the mock is skipped,
 * the app falls back to a WebSocket transport pointed at a server that does not
 * exist, and the office is never built — so every render times out waiting for
 * furniture that will never arrive, with no error logged anywhere.
 *
 * A container that sets NODE_ENV=production, which is otherwise the correct
 * thing to do for a Node service, would silently break every preview. Forcing
 * it here means the service cannot be misconfigured into that state.
 */
export function viteEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // NO_COLOR/FORCE_COLOR=0 belt-and-braces alongside extractDevServerUrl's
  // own ANSI stripping below — no reason to ask vite for colour codes we're
  // just going to parse around, on any runner that force-enables them.
  return { ...base, BROWSER: 'none', NODE_ENV: 'development', NO_COLOR: '1', FORCE_COLOR: '0' };
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

/**
 * Vite's "Local: http://127.0.0.1:PORT/" line, minus ANSI colour codes.
 *
 * GitHub Actions sets FORCE_COLOR, so vite colours its output even when
 * stdout is a pipe, not a TTY — and it colours the port number itself, so
 * the escape codes land *inside* the URL (`127.0.0.1:` + `\x1b[1m` +
 * `37513`). A plain `:\d+` regex against the raw buffer never matches, and
 * startDevServer sat out its whole timeout waiting for a URL that had
 * already been printed. Found live, in CI only — a local TTY shell strips
 * or renders the codes in a way that never hit this.
 */
export function extractDevServerUrl(buffer: string): string | null {
  const stripped = buffer.replace(ANSI_ESCAPE, '');
  const match = /(http:\/\/127\.0\.0\.1:\d+)\/?/.exec(stripped);
  return match?.[1] ?? null;
}

/** Vite rejects --port 0, so pick a free one ourselves. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not determine a free port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export async function startDevServer(upstreamDir?: string): Promise<DevServer> {
  const upstream = resolveUpstreamDir(upstreamDir);
  const webviewDir = path.join(upstream, 'webview-ui');

  if (!fs.existsSync(path.join(webviewDir, 'node_modules'))) {
    throw new Error(`Upstream dependencies are missing. Run:\n  (cd ${upstream} && npm ci)`);
  }

  // Spawn the binary directly rather than through npx: npx re-parents the real
  // vite process, so SIGTERM would kill only the wrapper and leave vite running
  // — and this process would then never exit. `detached` puts vite in its own
  // process group so it can be killed as a group, whatever it spawns.
  const viteBin = path.join(upstream, 'node_modules/.bin/vite');
  if (!fs.existsSync(viteBin)) {
    throw new Error(`Vite is missing. Run:\n  (cd ${upstream} && npm ci)`);
  }

  const port = await freePort();
  const child: ChildProcess = spawn(
    viteBin,
    ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: webviewDir,
      env: viteEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );

  const url = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`Vite dev server did not start in time. Output so far:\n${buffer}`)),
      DEV_STARTUP_TIMEOUT_MS,
    );
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const url = extractDevServerUrl(buffer);
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Vite dev server exited with code ${code}:\n${buffer}`));
    });
  }).catch((error: unknown) => {
    stop(child);
    throw error;
  });

  return { url, stop: () => stop(child) };
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    // Negative pid = the whole process group, so nothing is left behind holding
    // the port or keeping this process alive.
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}
