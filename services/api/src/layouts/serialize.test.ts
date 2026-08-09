import { describe, expect, it } from 'vitest';

import type { Layout, User } from '../db/schema.js';
import { toDetail, toSummary } from './serialize.js';

function makeLayout(overrides: Partial<Layout> = {}): Layout {
  const raw = '{"version":1,"cols":10,"rows":10}';
  return {
    id: 'layout-id',
    slug: 'a-layout',
    title: 'A Layout',
    description: 'a description',
    authorUserId: 'author-id',
    authorDisplay: null,
    raw,
    layout: JSON.parse(raw),
    sha256: 'a'.repeat(64),
    cols: 10,
    rows: 10,
    furnitureCount: 3,
    areaCount: 1,
    petCount: 0,
    carpetCount: 2,
    layoutRevision: 1,
    pixelAgentsVersion: '1.4.0',
    visibility: 'public',
    visibilityReason: null,
    visibilityChangedAt: null,
    visibilityChangedBy: null,
    searchVector: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'author-id',
    discordId: '123',
    username: 'someone',
    globalName: null,
    guildNickname: null,
    avatarUrl: 'https://cdn.discordapp.com/avatars/123/abc.png',
    role: 'user',
    isSystem: false,
    discordGuildMember: null,
    discordMembershipCheckedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('toSummary — author mapping', () => {
  it('a real user is exposed with their real id', () => {
    const summary = toSummary(makeLayout(), makeUser(), []);
    expect(summary.author).toEqual({
      id: 'author-id',
      username: 'someone',
      displayName: 'someone',
      avatarUrl: 'https://cdn.discordapp.com/avatars/123/abc.png',
    });
  });

  it('authorDisplay remains a fallback for legacy system-owned layouts', () => {
    // The system user's id (#3) is an implementation detail — a seed layout
    // is credited to a person, not to the account that technically owns the row.
    const summary = toSummary(
      makeLayout({ authorDisplay: 'legacy-credit' }),
      makeUser({ isSystem: true }),
      [],
    );
    expect(summary.author).toEqual({
      id: null,
      username: 'legacy-credit',
      displayName: 'legacy-credit',
      avatarUrl: null,
    });
  });

  it('falls back to "unknown" if somehow there is no author row and no display name', () => {
    const summary = toSummary(makeLayout(), null, []);
    expect(summary.author.username).toBe('unknown');
    expect(summary.author.id).toBeNull();
  });
});

describe('toSummary — fields', () => {
  it('maps every stat column to its public name', () => {
    const summary = toSummary(makeLayout(), makeUser(), ['cosy', 'small']);
    expect(summary).toMatchObject({
      slug: 'a-layout',
      title: 'A Layout',
      description: 'a description',
      tags: ['cosy', 'small'],
      cols: 10,
      rows: 10,
      furniture: 3,
      areas: 1,
      pets: 0,
      carpets: 2,
      layoutRevision: 1,
      pixelAgentsVersion: '1.4.0',
      sha256: 'a'.repeat(64),
    });
  });

  it('bytes is the UTF-8 byte length of raw, not the parsed object', () => {
    const raw = '{"a":"café"}'; // multi-byte character
    const summary = toSummary(makeLayout({ raw, layout: JSON.parse(raw) }), makeUser(), []);
    expect(summary.bytes).toBe(Buffer.byteLength(raw, 'utf-8'));
    expect(summary.bytes).not.toBe(raw.length); // would differ if this ever regresses to .length
  });

  it('timestamps are ISO strings', () => {
    const summary = toSummary(makeLayout(), makeUser(), []);
    expect(summary.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(summary.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('files are relative API paths keyed on the slug', () => {
    const summary = toSummary(makeLayout({ slug: 'my-office' }), makeUser(), []);
    expect(summary.files).toEqual({
      layout: '/api/v1/layouts/my-office/download',
      preview: '/api/v1/layouts/my-office/preview.png',
      thumbnail: '/api/v1/layouts/my-office/thumbnail.png',
    });
  });
});

describe('toDetail', () => {
  it('includes everything toSummary has, plus the parsed layout', () => {
    const layout = makeLayout();
    const detail = toDetail(layout, makeUser(), []);
    expect(detail).toMatchObject(toSummary(layout, makeUser(), []));
    expect(detail.layout).toEqual(layout.layout);
  });
});
