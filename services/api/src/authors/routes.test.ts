import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { buildServer } from '../server.js';
import { testConfig } from '../test-support/config.js';
import { insertLayout, insertUser } from '../test-support/layouts.js';

let harness: Harness;
let app: FastifyInstance;
beforeAll(async () => {
  harness = await createTestDatabase();
  app = await buildServer({
    config: testConfig(),
    db: harness.db,
    pool: { query: async () => ({ rows: [] }) },
  });
});
afterAll(async () => {
  await app.close();
  await harness.close();
});

describe('GET /api/v1/authors/:id', () => {
  it('returns public profile data and counts only public layouts', async () => {
    const author = await insertUser(harness.db, {
      username: 'discord-handle',
      globalName: 'Global Name',
      guildNickname: 'Guild Nick',
      avatarUrl: 'https://cdn.discordapp.com/avatar.png',
    });
    await insertLayout(harness.db, { authorUserId: author.id, visibility: 'public' });
    await insertLayout(harness.db, { authorUserId: author.id, visibility: 'hidden' });
    const response = await app.inject({ method: 'GET', url: `/api/v1/authors/${author.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      author: {
        id: author.id,
        username: 'discord-handle',
        displayName: 'Guild Nick',
        avatarUrl: 'https://cdn.discordapp.com/avatar.png',
      },
      publicLayoutCount: 1,
    });
    expect(response.body).not.toContain('discordId');
    expect(response.body).not.toContain('role');
  });

  it('does not expose users with no public layouts or the synthetic system user', async () => {
    const privateAuthor = await insertUser(harness.db);
    await insertLayout(harness.db, { authorUserId: privateAuthor.id, visibility: 'removed' });
    const privateResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/authors/${privateAuthor.id}`,
    });
    const system = await insertUser(harness.db, { discordId: null, isSystem: true });
    await insertLayout(harness.db, { authorUserId: system.id, visibility: 'public' });
    const systemResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/authors/${system.id}`,
    });
    expect(privateResponse.statusCode).toBe(404);
    expect(systemResponse.statusCode).toBe(404);
  });
});
