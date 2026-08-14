import { bundledLayoutRevision } from '@pixel-index/layout-core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';

import { signAccessToken } from '../auth/tokens.js';
import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import { insertLayout, insertUser } from '../test-support/layouts.js';
import type { ImportReportBody } from './import.js';
import type { BackupManifest } from './manifest.js';

const config = testConfig({ writeRateLimit: { max: 1000, windowMs: 60_000 } });
const fakePool = { query: async () => ({ rows: [] }) };
const BUNDLED_REVISION = bundledLayoutRevision();

let harness: Harness;
let app: FastifyInstance;
beforeAll(async () => {
  harness = await createTestDatabase();
  app = await buildServer({ config, pool: fakePool, db: harness.db });
});
afterAll(async () => {
  await app.close();
  await harness.close();
});

async function tokenFor(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(harness.db, overrides);
  if (overrides.role === 'moderator' || overrides.role === 'admin') {
    assert(user.discordId !== null, 'insertUser did not give this user a Discord id');
    config.discordAdminIds.push(user.discordId);
  }
  const accessToken = await signAccessToken(
    { sub: user.id, role: user.role },
    config.sessionSecret,
    config.accessTokenTtlMs,
  );
  return { user, accessToken };
}

let marker = 0;
function validLayoutJson(overrides: Record<string, unknown> = {}): string {
  marker += 1;
  return JSON.stringify({
    version: 1,
    layoutRevision: BUNDLED_REVISION,
    cols: 4,
    rows: 4,
    tiles: Array(16).fill(0),
    furniture: [],
    testMarker: marker,
    ...overrides,
  });
}

function validMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'A layout',
    author: 'someone',
    description: 'A description.',
    ...overrides,
  };
}

async function zipOf(entries: Record<string, { layout?: string; meta?: Record<string, unknown> | string }>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [slug, entry] of Object.entries(entries)) {
    if (entry.layout !== undefined) zip.file(`${slug}/layout.json`, entry.layout);
    if (entry.meta !== undefined) {
      zip.file(`${slug}/meta.json`, typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta));
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function getBackup(accessToken?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/admin/backup',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

async function fileText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  assert(file !== null, `zip is missing ${path}`);
  return file.async('string');
}

function postImport(payload: Buffer, accessToken?: string, query = '') {
  return app.inject({
    method: 'POST',
    url: `/api/v1/admin/backup/import${query}`,
    headers: {
      'content-type': 'application/zip',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    payload,
  });
}

describe('GET /api/v1/admin/backup', () => {
  it('is admin-only', async () => {
    const { accessToken: userToken } = await tokenFor();
    expect((await getBackup()).statusCode).toBe(401);
    expect((await getBackup(userToken)).statusCode).toBe(403);
  });

  it('zips public and hidden layouts, mirroring seed/\'s <slug>/{layout.json,meta.json} shape, and excludes deleted', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const raw = validLayoutJson();
    await insertLayout(harness.db, { slug: 'backup-public', raw, layout: JSON.parse(raw), title: 'Public One' });
    const rawHidden = validLayoutJson();
    await insertLayout(harness.db, {
      slug: 'backup-hidden',
      raw: rawHidden,
      layout: JSON.parse(rawHidden),
      visibility: 'hidden',
    });
    await insertLayout(harness.db, { slug: 'backup-deleted', visibility: 'deleted' });

    const response = await getBackup(adminToken);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');

    const zip = await JSZip.loadAsync(response.rawPayload);
    const manifest = JSON.parse(await fileText(zip, 'manifest.json')) as BackupManifest;
    expect(manifest.schemaVersion).toBe(1);
    expect(typeof manifest.generatedAt).toBe('string');

    expect(await fileText(zip, 'backup-public/layout.json')).toBe(raw);
    const publicMeta = JSON.parse(await fileText(zip, 'backup-public/meta.json')) as Record<string, unknown>;
    expect(publicMeta).toMatchObject({ title: 'Public One', visibility: 'public' });

    expect(await fileText(zip, 'backup-hidden/layout.json')).toBe(rawHidden);
    const hiddenMeta = JSON.parse(await fileText(zip, 'backup-hidden/meta.json')) as Record<string, unknown>;
    expect(hiddenMeta).toMatchObject({ visibility: 'hidden' });

    expect(zip.file('backup-deleted/layout.json')).toBeNull();
  });
});

describe('POST /api/v1/admin/backup/import', () => {
  it('is admin-only', async () => {
    const { accessToken: userToken } = await tokenFor();
    const zip = await zipOf({});
    expect((await postImport(zip)).statusCode).toBe(401);
    expect((await postImport(zip, userToken)).statusCode).toBe(403);
  });

  it('rejects a body that is not a zip', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const response = await postImport(Buffer.from('not a zip'), adminToken);
    expect(response.statusCode).toBe(400);
  });

  it('creates a new layout at the exact slug the zip names, and records a layout.import audit entry', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const raw = validLayoutJson();
    const zip = await zipOf({
      'import-new-slug': { layout: raw, meta: validMeta({ title: 'Imported', tags: ['cosy'] }) },
    });

    const response = await postImport(zip, adminToken);
    expect(response.statusCode).toBe(200);
    const body = response.json<ImportReportBody>();
    expect(body).toMatchObject({ created: 1, updated: 0, failed: [] });

    const [row] = await harness.db
      .select()
      .from(schema.layouts)
      .where(eq(schema.layouts.slug, 'import-new-slug'));
    assert(row !== undefined, 'the import did not create a row at import-new-slug');
    expect(row).toMatchObject({ title: 'Imported', raw, visibility: 'public' });

    const [tagRow] = await harness.db
      .select({ name: schema.tags.name })
      .from(schema.layoutTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.layoutTags.tagId))
      .where(eq(schema.layoutTags.layoutId, row.id));
    expect(tagRow?.name).toBe('cosy');

    const [action] = await harness.db
      .select()
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.targetId, row.id));
    expect(action?.action).toBe('layout.import');
  });

  it('upserts: an existing slug is overwritten rather than skipped or rejected', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const original = await insertLayout(harness.db, {
      slug: 'import-collision',
      title: 'Original title',
      visibility: 'public',
    });

    const raw = validLayoutJson();
    const zip = await zipOf({
      'import-collision': { layout: raw, meta: validMeta({ title: 'Restored title', visibility: 'hidden' }) },
    });

    const response = await postImport(zip, adminToken);
    expect(response.json<ImportReportBody>()).toMatchObject({ created: 0, updated: 1, failed: [] });

    const [row] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.id, original.id));
    expect(row).toMatchObject({ slug: 'import-collision', title: 'Restored title', raw, visibility: 'hidden' });
  });

  it('does not stamp visibilityChangedAt/By when a re-imported entry keeps the same visibility', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const original = await insertLayout(harness.db, {
      slug: 'import-same-visibility',
      visibility: 'public',
      visibilityChangedAt: null,
      visibilityChangedBy: null,
    });

    const zip = await zipOf({
      'import-same-visibility': { layout: validLayoutJson(), meta: validMeta({ visibility: 'public' }) },
    });
    await postImport(zip, adminToken);

    const [row] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.id, original.id));
    expect(row?.visibilityChangedAt).toBeNull();
    expect(row?.visibilityChangedBy).toBeNull();
  });

  it('reports a per-entry failure without failing the rest of the import', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const goodRaw = validLayoutJson();
    const zip = await zipOf({
      'import-good': { layout: goodRaw, meta: validMeta({ title: 'Good' }) },
      'import-bad': { layout: 'not json at all', meta: validMeta() },
      'import-no-meta': { layout: validLayoutJson() },
    });

    const response = await postImport(zip, adminToken);
    const body = response.json<ImportReportBody>();
    expect(body.created).toBe(1);
    expect(body.failed.map((f) => f.slug).sort()).toEqual(['import-bad', 'import-no-meta']);

    const [row] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.slug, 'import-good'));
    expect(row?.raw).toBe(goodRaw);
  });

  it('records the optional ?reason= query param on the audit entry', async () => {
    const { accessToken: adminToken } = await tokenFor({ role: 'admin' });
    const raw = validLayoutJson();
    const zip = await zipOf({ 'import-reasoned': { layout: raw, meta: validMeta() } });

    await postImport(zip, adminToken, '?reason=restoring+from+2026-08-14+backup');

    const [row] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.slug, 'import-reasoned'));
    assert(row !== undefined, 'the import did not create a row at import-reasoned');
    const [action] = await harness.db
      .select()
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.targetId, row.id));
    expect(action?.reason).toBe('restoring from 2026-08-14 backup');
  });

  it('refuses a body over its own, larger body limit', async () => {
    const overCapConfig = testConfig({
      writeRateLimit: { max: 1000, windowMs: 60_000 },
      maxImportBytes: 100,
    });
    const overCapApp = await buildServer({ config: overCapConfig, pool: fakePool, db: harness.db });
    try {
      const { user } = await insertUser(harness.db, { role: 'admin' }).then(async (u) => {
        assert(u.discordId !== null);
        overCapConfig.discordAdminIds.push(u.discordId);
        return { user: u };
      });
      const accessToken = await signAccessToken(
        { sub: user.id, role: user.role },
        overCapConfig.sessionSecret,
        overCapConfig.accessTokenTtlMs,
      );
      const zip = await zipOf({
        'import-too-big': { layout: validLayoutJson({ padding: 'x'.repeat(1000) }), meta: validMeta() },
      });
      const response = await overCapApp.inject({
        method: 'POST',
        url: '/api/v1/admin/backup/import',
        headers: { 'content-type': 'application/zip', authorization: `Bearer ${accessToken}` },
        payload: zip,
      });
      expect(response.statusCode).toBe(413);
    } finally {
      await overCapApp.close();
    }
  });
});
