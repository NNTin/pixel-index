import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fetchExportedLayouts, loadSeedLayouts } from './source.js';
import { HarnessInfraError } from './types.js';

const temporaryDirs: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function seedDir(layouts: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-'));
  temporaryDirs.push(dir);
  for (const [slug, layout] of Object.entries(layouts)) {
    fs.mkdirSync(path.join(dir, slug));
    fs.writeFileSync(path.join(dir, slug, 'layout.json'), JSON.stringify(layout));
  }
  return dir;
}

function ndjsonResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

describe('loadSeedLayouts', () => {
  it('reads <dir>/<slug>/layout.json, sorted', () => {
    const dir = seedDir({ zebra: { cols: 1 }, alpha: { cols: 2 } });
    expect(loadSeedLayouts(dir)).toEqual([
      { slug: 'alpha', layout: { cols: 2 } },
      { slug: 'zebra', layout: { cols: 1 } },
    ]);
  });

  it('raises an infra error, not a verdict, for a missing directory', () => {
    expect(() => loadSeedLayouts('/nope/definitely/not/here')).toThrow(HarnessInfraError);
  });

  it('raises an infra error for an empty directory rather than passing vacuously', () => {
    // "Zero layouts checked, nothing broke" is the most dangerous possible
    // green check — it looks exactly like success.
    expect(() => loadSeedLayouts(seedDir({}))).toThrow(HarnessInfraError);
  });
});

describe('fetchExportedLayouts', () => {
  it('parses one layout per line', async () => {
    const body =
      JSON.stringify({ slug: 'a', layout: { cols: 1 } }) +
      '\n' +
      JSON.stringify({ slug: 'b', layout: { cols: 2 } }) +
      '\n';
    const layouts = await fetchExportedLayouts('https://api.example.com', async () =>
      ndjsonResponse(body, { 'x-total-count': '2' }),
    );
    expect(layouts).toEqual([
      { slug: 'a', layout: { cols: 1 } },
      { slug: 'b', layout: { cols: 2 } },
    ]);
  });

  it('detects a truncated stream via x-total-count', async () => {
    // A stream cut short after the 200 cannot be signalled with a status code,
    // so without this check half an index would look like a smaller index and
    // the gate would pass on the half that arrived.
    const body = JSON.stringify({ slug: 'a', layout: {} }) + '\n';
    await expect(
      fetchExportedLayouts('https://api.example.com', async () =>
        ndjsonResponse(body, { 'x-total-count': '9' }),
      ),
    ).rejects.toThrow(/truncated/);
  });

  it('reports an unreachable index as infrastructure, never as a vendor verdict', async () => {
    await expect(
      fetchExportedLayouts('https://api.example.com', async () => {
        throw new TypeError('fetch failed');
      }),
    ).rejects.toThrow(HarnessInfraError);
  });

  it('reports a non-2xx as infrastructure too', async () => {
    await expect(
      fetchExportedLayouts('https://api.example.com', async () => new Response('', { status: 503 })),
    ).rejects.toThrow(HarnessInfraError);
  });

  it('diagnoses a 404 as an index that predates the endpoint', async () => {
    // Hit for real on the first live run: the export ships with this gate, so
    // an index that 404s is running an older build. Reported as "could not be
    // read" it sends someone hunting for a misconfigured variable that is fine.
    await expect(
      fetchExportedLayouts('https://api.example.com', async () => new Response('', { status: 404 })),
    ).rejects.toThrow(/running a build from before it existed — redeploy the API/);
  });

  it('tolerates a trailing slash on the base URL', async () => {
    let seen = '';
    await fetchExportedLayouts('https://api.example.com/', async (url) => {
      seen = String(url);
      return ndjsonResponse('');
    });
    expect(seen).toBe('https://api.example.com/api/v1/export/layouts.ndjson');
  });
});
