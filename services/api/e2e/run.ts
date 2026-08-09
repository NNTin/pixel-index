/**
 * End-to-end verification against real containers — Postgres, the renderer
 * microservice, and the API itself, the actual built Docker images, not test
 * doubles or a stubbed renderer (unlike src/**\/*.test.ts, which is
 * deliberately fast and hermetic). Run via `e2e.sh`, which builds the images,
 * brings the stack up with docker compose, and execs this script.
 *
 * Deliberately not vitest: nothing here is an independent unit, there is no
 * per-test isolation (everything shares one running stack, one database),
 * and a plain top-to-bottom script reads as the story of one full
 * owner-then-moderator session, which is what actually needs proving here —
 * unit coverage of the same guards already lives in manage.test.ts and
 * users/routes.test.ts.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

import { signAccessToken } from '../src/auth/tokens.js';

const API_URL = process.env.API_URL ?? 'http://localhost:18080';
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!DATABASE_URL || !SESSION_SECRET) {
  throw new Error('DATABASE_URL and SESSION_SECRET are required — see e2e.sh');
}

const db = new Client({ connectionString: DATABASE_URL });

let userCounter = 0;
async function createUser(role: 'user' | 'moderator' | 'admin' = 'user') {
  userCounter += 1;
  const discordId = `e2e-${Date.now()}-${userCounter}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (discord_id, username, role) VALUES ($1, $1, $2) RETURNING id`,
    [discordId, role],
  );
  const id = rows[0]!.id;
  const accessToken = await signAccessToken({ sub: id, role }, SESSION_SECRET!, 15 * 60_000);
  return { id, accessToken };
}

/** Directly seeds a `deleted` layout — standing in for "a layout that existed and was withdrawn", without needing a submit+delete round trip for content the test never wants live. */
async function seedDeletedLayout(authorUserId: string, raw: string) {
  const sha256 = createHash('sha256').update(raw).digest('hex');
  await db.query(
    `INSERT INTO layouts (slug, title, author_user_id, raw, layout, sha256, cols, rows,
       furniture_count, area_count, pet_count, carpet_count, layout_revision,
       pixel_agents_version, visibility)
     VALUES ($1, 'E2E seed', $2, $3::text, $3::jsonb, $4, 1, 1, 0, 0, 0, 0, 1, '0.0.0', 'deleted')`,
    [`e2e-seed-${Date.now()}-${userCounter}`, authorUserId, raw, sha256],
  );
}

function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, headers, ...rest } = init;
  return fetch(`${API_URL}${path}`, {
    ...rest,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

/** Response bodies here are the API's own JSON, not something worth typing twice for a throwaway script. */
async function json(res: Response): Promise<any> {
  return res.json();
}

function layoutJson(cols: number, rows: number) {
  return JSON.stringify({
    version: 1,
    layoutRevision: 1,
    cols,
    rows,
    tiles: Array(cols * rows).fill(0),
    furniture: [],
  });
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ok  - ${name}`);
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const res = await api('/ready').catch(() => null);
    if (res?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('/ready never returned 200');
}

async function main() {
  await db.connect();
  await waitUntilReady();

  await step('a real pinned upstream is reported at /api/v1/meta', async () => {
    const meta = await json(await api("/api/v1/meta"));
    assert.match(meta.pixelAgents.version, /^\d+\.\d+\.\d+/);

    // The commit, from inside a real container — the one thing no unit test
    // can prove. A copied vendor/ tree has no usable git (its .git is a
    // pointer to a gitdir that was never copied), so this can only be
    // answered by the stamp the Dockerfile copies beside it. It was a
    // build argument once, nobody passed it, and every deployed image
    // reported null; this is what makes that regression loud instead of
    // something you notice months later in a preview that will not update.
    assert.match(
      meta.pixelAgents.commit ?? '',
      /^[0-9a-f]{40}$/,
      'the image reported no upstream commit — is vendor/pixel-agents.commit copied in?',
    );
    assert.equal(
      meta.pixelAgents.commit,
      readFileSync(new URL('../../../vendor/pixel-agents.commit', import.meta.url), 'utf-8').trim(),
      'the image reports a different upstream than this checkout pins',
    );
  });

  const owner = await createUser('user');
  const moderator = await createUser('moderator');
  const admin = await createUser('admin');
  const stranger = await createUser('user');

  let slug = '';

  await step('owner submits a layout and the renderer produces a real preview', async () => {
    const res = await api('/api/v1/layouts?title=E2E+Office', {
      method: 'POST',
      token: owner.accessToken,
      headers: { 'content-type': 'application/json' },
      body: layoutJson(4, 4),
    });
    assert.equal(res.status, 201);
    const body = await json(res);
    assert.equal(body.previewReady, true);
    slug = body.slug;

    const preview = await api(`/api/v1/layouts/${slug}/preview.png`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');
  });

  await step('a stranger cannot edit it', async () => {
    const res = await api(`/api/v1/layouts/${slug}`, {
      method: 'PATCH',
      token: stranger.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    assert.equal(res.status, 403);
  });

  await step('the owner edits their own title with no reason required', async () => {
    const res = await api(`/api/v1/layouts/${slug}`, {
      method: 'PATCH',
      token: owner.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'E2E Office Renamed' }),
    });
    assert.equal(res.status, 200);
  });

  await step('the owner cannot set visibility, even on their own layout', async () => {
    const res = await api(`/api/v1/layouts/${slug}`, {
      method: 'PATCH',
      token: owner.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'hidden', reason: 'nope' }),
    });
    assert.equal(res.status, 403);
  });

  await step('a moderator hiding without a reason is rejected', async () => {
    const res = await api(`/api/v1/layouts/${slug}`, {
      method: 'PATCH',
      token: moderator.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'hidden' }),
    });
    assert.equal(res.status, 400);
  });

  await step('a moderator hides it with a reason, and it vanishes from the public API', async () => {
    const res = await api(`/api/v1/layouts/${slug}`, {
      method: 'PATCH',
      token: moderator.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'hidden', reason: 'e2e moderation test' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await api(`/api/v1/layouts/${slug}`)).status, 404);
  });

  await step('a moderator restores it', async () => {
    const res = await api(`/api/v1/layouts/${slug}`, {
      method: 'PATCH',
      token: moderator.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'public', reason: 'appeal granted' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await api(`/api/v1/layouts/${slug}`)).status, 200);
  });

  await step('a moderator cannot replace the layout content, only the owner can', async () => {
    const modAttempt = await api(`/api/v1/layouts/${slug}/layout`, {
      method: 'PUT',
      token: moderator.accessToken,
      headers: { 'content-type': 'application/json' },
      body: layoutJson(5, 5),
    });
    assert.equal(modAttempt.status, 403);

    const raw = layoutJson(6, 6);
    const ownerAttempt = await api(`/api/v1/layouts/${slug}/layout`, {
      method: 'PUT',
      token: owner.accessToken,
      headers: { 'content-type': 'application/json' },
      body: raw,
    });
    assert.equal(ownerAttempt.status, 200);
    assert.equal(await (await api(`/api/v1/layouts/${slug}/download`)).text(), raw);
  });

  await step('the owner deletes it, and re-deleting is a no-op', async () => {
    const first = await api(`/api/v1/layouts/${slug}`, { method: 'DELETE', token: owner.accessToken });
    assert.equal(first.status, 204);
    const second = await api(`/api/v1/layouts/${slug}`, { method: 'DELETE', token: owner.accessToken });
    assert.equal(second.status, 204);
    assert.equal((await api(`/api/v1/layouts/${slug}`)).status, 404);
  });

  await step(
    "a stranger cannot launder content by resubmitting someone else's deleted layout, but the same owner can",
    async () => {
      const raw = layoutJson(9, 9);
      await seedDeletedLayout(owner.id, raw);

      const strangerAttempt = await api('/api/v1/layouts?title=Laundering+Attempt', {
        method: 'POST',
        token: stranger.accessToken,
        headers: { 'content-type': 'application/json' },
        body: raw,
      });
      assert.equal(strangerAttempt.status, 409);

      const ownerAttempt = await api('/api/v1/layouts?title=Owner+Republish', {
        method: 'POST',
        token: owner.accessToken,
        headers: { 'content-type': 'application/json' },
        body: raw,
      });
      assert.equal(ownerAttempt.status, 201);
    },
  );

  await step('only an admin can change roles, and never their own', async () => {
    const modAttempt = await api(`/api/v1/users/${stranger.id}/role`, {
      method: 'PATCH',
      token: moderator.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'moderator' }),
    });
    assert.equal(modAttempt.status, 403);

    const selfAttempt = await api(`/api/v1/users/${admin.id}/role`, {
      method: 'PATCH',
      token: admin.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(selfAttempt.status, 403);

    const promote = await api(`/api/v1/users/${stranger.id}/role`, {
      method: 'PATCH',
      token: admin.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'moderator' }),
    });
    assert.equal(promote.status, 200);
    assert.equal((await json(promote)).role, 'moderator');
  });

  await step('blocking requires a reason, hides existing layouts, and a fresh row backs the write check', async () => {
    const target = await createUser('user');
    const submitRes = await api('/api/v1/layouts?title=Blockable', {
      method: 'POST',
      token: target.accessToken,
      headers: { 'content-type': 'application/json' },
      body: layoutJson(4, 4),
    });
    const targetSlug = (await json(submitRes)).slug;

    const noReason = await api(`/api/v1/users/${target.id}/block`, {
      method: 'PATCH',
      token: moderator.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocked: true }),
    });
    assert.equal(noReason.status, 400);

    const block = await api(`/api/v1/users/${target.id}/block`, {
      method: 'PATCH',
      token: moderator.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocked: true, reason: 'e2e block test' }),
    });
    assert.equal(block.status, 200);
    assert.equal((await api(`/api/v1/layouts/${targetSlug}`)).status, 404);

    // Same still-valid access token, now failing a write — proves the check
    // re-fetches the row instead of trusting the token's role/block claim.
    const blockedWrite = await api('/api/v1/layouts?title=Should+Fail', {
      method: 'POST',
      token: target.accessToken,
      headers: { 'content-type': 'application/json' },
      body: layoutJson(4, 4),
    });
    assert.equal(blockedWrite.status, 403);

    const unblock = await api(`/api/v1/users/${target.id}/block`, {
      method: 'PATCH',
      token: moderator.accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocked: false }),
    });
    assert.equal(unblock.status, 200);
    assert.equal((await api(`/api/v1/layouts/${targetSlug}`)).status, 404); // unblocking does not auto-restore
  });
}

try {
  await main();
  console.log(`\n${passed} e2e steps passed.`);
} finally {
  await db.end();
}
