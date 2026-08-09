import { bundledLayoutRevision, sha256 } from '@pixel-index/layout-core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signAccessToken } from '../auth/tokens.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import { insertLayout, insertUser } from '../test-support/layouts.js';

const config = testConfig({
  discordGuild: {
    id: '1478428628709802166',
    inviteUrl: 'https://discord.gg/pixel-index',
    moderatorRoleIds: ['1528065925264445622'],
    oauthTokenEncryptionKey: Buffer.alloc(32, 3).toString('base64'),
  },
  writeRateLimit: { max: 100, windowMs: 60_000 },
});
let harness: Harness;
let app: FastifyInstance;
let accessToken: string;
let slug: string;

beforeAll(async () => {
  harness = await createTestDatabase();
  app = await buildServer({
    config,
    db: harness.db,
    pool: { query: async () => ({ rows: [] }) },
  });
  const departed = await insertUser(harness.db, {
    username: 'departed-member',
    discordGuildMember: false,
    discordMembershipCheckedAt: new Date(),
  });
  accessToken = await signAccessToken({ sub: departed.id }, config.sessionSecret, 60_000);
  const raw = JSON.stringify({
    version: 1,
    layoutRevision: bundledLayoutRevision(),
    cols: 2,
    rows: 2,
    tiles: [0, 0, 0, 0],
    furniture: [],
  });
  const layout = await insertLayout(harness.db, {
    slug: 'departed-member-layout',
    authorUserId: departed.id,
    raw,
    layout: JSON.parse(raw),
    sha256: sha256(raw),
    visibility: 'public',
  });
  slug = layout.slug;
});
afterAll(async () => {
  await app.close();
  await harness.close();
});

const authorization = () => ({ authorization: `Bearer ${accessToken}` });

describe('confirmed guild departure', () => {
  it('leaves existing layouts public but rejects submission, preview, edit and replacement', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/v1/layouts/${slug}` })).statusCode).toBe(200);

    const raw = JSON.stringify({
      version: 1,
      layoutRevision: bundledLayoutRevision(),
      cols: 2,
      rows: 2,
      tiles: [0, 0, 0, 0],
      furniture: [],
      different: true,
    });
    const submission = await app.inject({
      method: 'POST',
      url: '/api/v1/layouts?title=Nope',
      payload: raw,
      headers: { ...authorization(), 'content-type': 'application/json' },
    });
    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/layouts/preview-check',
      payload: raw,
      headers: { ...authorization(), 'content-type': 'application/json' },
    });
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/layouts/${slug}`,
      payload: { title: 'Nope' },
      headers: authorization(),
    });
    const replacement = await app.inject({
      method: 'PUT',
      url: `/api/v1/layouts/${slug}/layout`,
      payload: raw,
      headers: { ...authorization(), 'content-type': 'application/json' },
    });
    for (const response of [submission, preview, edit, replacement]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('discord_membership_required');
    }
    expect((await app.inject({ method: 'GET', url: `/api/v1/layouts/${slug}` })).statusCode).toBe(200);
  });

  it('still permits owner listing and deletion', async () => {
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/me/layouts',
      headers: authorization(),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().layouts.some((layout: { slug: string }) => layout.slug === slug)).toBe(true);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/layouts/${slug}`,
      headers: authorization(),
    });
    expect(deleted.statusCode).toBe(204);
  });
});
