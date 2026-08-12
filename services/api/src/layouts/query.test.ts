import { eq } from 'drizzle-orm';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../db/schema.js';
import { createTestDatabase, type Harness } from '../db/test-support/harness.js';
import { insertLayout, insertUser, tagLayout } from '../test-support/layouts.js';
import {
  countPublicLayouts,
  getLayoutBySlug,
  getLayoutBySlugAnyVisibility,
  listLayouts,
  tagsForLayouts,
} from './query.js';

let harness: Harness;
beforeAll(async () => {
  harness = await createTestDatabase();
});
afterAll(async () => harness.close());

describe('getLayoutBySlug', () => {
  it('finds a public layout', async () => {
    const layout = await insertLayout(harness.db, { slug: 'findable' });
    expect((await getLayoutBySlug(harness.db, layout.slug))?.id).toBe(layout.id);
  });

  it('returns null for an unknown slug', async () => {
    expect(await getLayoutBySlug(harness.db, 'does-not-exist')).toBeNull();
  });

  it.each(['hidden', 'removed', 'deleted'] as const)(
    'returns null for a %s layout — indistinguishable from never having existed',
    async (visibility) => {
      const layout = await insertLayout(harness.db, { slug: `not-public-${visibility}`, visibility });
      expect(await getLayoutBySlug(harness.db, layout.slug)).toBeNull();
    },
  );
});

describe('countPublicLayouts', () => {
  it('counts only public layouts', async () => {
    const before = await countPublicLayouts(harness.db);
    await insertLayout(harness.db, { visibility: 'public' });
    await insertLayout(harness.db, { visibility: 'hidden' });
    expect(await countPublicLayouts(harness.db)).toBe(before + 1);
  });
});

describe('listLayouts — visibility', () => {
  it('never returns a non-public layout', async () => {
    const hidden = await insertLayout(harness.db, { slug: 'visibility-hidden-x', visibility: 'hidden' });
    const { rows } = await listLayouts(harness.db, {
      filters: {},
      sort: 'newest',
      limit: 100,
    });
    expect(rows.some((row) => row.id === hidden.id)).toBe(false);
  });
});

describe('listLayouts — owner scope', () => {
  it('returns every visibility for the owner, and excludes other authors entirely', async () => {
    const owner = await insertUser(harness.db);
    const other = await insertUser(harness.db);
    const mine1 = await insertLayout(harness.db, { authorUserId: owner.id, visibility: 'public' });
    const mine2 = await insertLayout(harness.db, { authorUserId: owner.id, visibility: 'hidden' });
    await insertLayout(harness.db, { authorUserId: other.id, visibility: 'public' });

    const { rows } = await listLayouts(harness.db, {
      filters: {},
      sort: 'newest',
      limit: 100,
      scope: { type: 'owner', userId: owner.id },
    });
    expect(rows.map((r) => r.id).sort()).toEqual([mine1.id, mine2.id].sort());
  });
});

describe('getLayoutBySlugAnyVisibility', () => {
  it('finds a non-public layout, unlike getLayoutBySlug', async () => {
    const layout = await insertLayout(harness.db, { slug: 'any-visibility-hidden', visibility: 'hidden' });
    expect((await getLayoutBySlugAnyVisibility(harness.db, layout.slug))?.id).toBe(layout.id);
  });

  it('returns null for an unknown slug', async () => {
    expect(await getLayoutBySlugAnyVisibility(harness.db, 'does-not-exist-either')).toBeNull();
  });
});

describe('listLayouts — filters compose', () => {
  it('author + tag + size range together narrow to the intersection', async () => {
    const author = await insertUser(harness.db, { username: 'compose-author' });
    const other = await insertUser(harness.db, { username: 'compose-other' });

    const match = await insertLayout(harness.db, {
      slug: 'compose-match',
      authorUserId: author.id,
      cols: 20,
      rows: 20,
    });
    await tagLayout(harness.db, match.id, 'cosy');
    await tagLayout(harness.db, match.id, 'small');

    // Same author, missing the tag.
    await insertLayout(harness.db, { slug: 'compose-wrong-tag', authorUserId: author.id, cols: 20, rows: 20 });
    // Same tag, wrong author.
    const wrongAuthor = await insertLayout(harness.db, {
      slug: 'compose-wrong-author',
      authorUserId: other.id,
      cols: 20,
      rows: 20,
    });
    await tagLayout(harness.db, wrongAuthor.id, 'cosy');
    await tagLayout(harness.db, wrongAuthor.id, 'small');
    // Same author and tags, outside the size range.
    const tooSmall = await insertLayout(harness.db, {
      slug: 'compose-too-small',
      authorUserId: author.id,
      cols: 5,
      rows: 5,
    });
    await tagLayout(harness.db, tooSmall.id, 'cosy');
    await tagLayout(harness.db, tooSmall.id, 'small');

    const { rows, total } = await listLayouts(harness.db, {
      filters: { author: author.id, tags: ['cosy', 'small'], cols: { min: 15 }, rows: { min: 15 } },
      sort: 'newest',
      limit: 100,
    });

    expect(rows.map((r) => r.slug)).toEqual(['compose-match']);
    expect(total).toBe(1);
  });

  it('tags filter is ALL-match, not any', async () => {
    const both = await insertLayout(harness.db, { slug: 'tags-both' });
    await tagLayout(harness.db, both.id, 'open-plan');
    await tagLayout(harness.db, both.id, 'quiet');

    const onlyOne = await insertLayout(harness.db, { slug: 'tags-only-one' });
    await tagLayout(harness.db, onlyOne.id, 'open-plan');

    const { rows } = await listLayouts(harness.db, {
      filters: { tags: ['open-plan', 'quiet'] },
      sort: 'newest',
      limit: 100,
    });
    expect(rows.map((r) => r.slug)).toContain('tags-both');
    expect(rows.map((r) => r.slug)).not.toContain('tags-only-one');
  });

  it('free text matches title and description via the search vector', async () => {
    await insertLayout(harness.db, {
      slug: 'q-macrodata',
      title: 'Severance Office',
      description: 'macrodata refinement floor',
    });
    const { rows } = await listLayouts(harness.db, {
      filters: { q: 'macrodata' },
      sort: 'newest',
      limit: 100,
    });
    expect(rows.map((r) => r.slug)).toContain('q-macrodata');
  });

  it('numeric ranges are inclusive at both ends', async () => {
    const exact = await insertLayout(harness.db, { slug: 'furniture-exact', furnitureCount: 10 });
    await insertLayout(harness.db, { slug: 'furniture-below', furnitureCount: 9 });
    await insertLayout(harness.db, { slug: 'furniture-above', furnitureCount: 11 });

    const { rows } = await listLayouts(harness.db, {
      filters: { furniture: { min: 10, max: 10 } },
      sort: 'newest',
      limit: 100,
    });
    expect(rows.map((r) => r.id)).toContain(exact.id);
    expect(rows.map((r) => r.slug)).not.toContain('furniture-below');
    expect(rows.map((r) => r.slug)).not.toContain('furniture-above');
  });

  it('filters by tile count (visibleCols × visibleRows), not cols/rows independently', async () => {
    // 21×22 = 462, same worked example as #24. A long thin layout (7×66 =
    // 462) matches the same size filter despite failing any cols/rows bucket
    // — the whole point of filtering on the product, not the two axes.
    // visibleCols/visibleRows is set equal to cols/rows here (a fully-occupied
    // canvas), so this exercises the same principle as before #55 on the
    // field that now actually drives the filter.
    const square = await insertLayout(harness.db, {
      slug: 'size-square',
      cols: 21,
      rows: 22,
      visibleCols: 21,
      visibleRows: 22,
    });
    const thin = await insertLayout(harness.db, {
      slug: 'size-thin',
      cols: 7,
      rows: 66,
      visibleCols: 7,
      visibleRows: 66,
    });
    await insertLayout(harness.db, {
      slug: 'size-below',
      cols: 21,
      rows: 21,
      visibleCols: 21,
      visibleRows: 21,
    }); // 441
    await insertLayout(harness.db, {
      slug: 'size-above',
      cols: 22,
      rows: 22,
      visibleCols: 22,
      visibleRows: 22,
    }); // 484

    const { rows } = await listLayouts(harness.db, {
      filters: { size: { min: 462, max: 462 } },
      sort: 'newest',
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(square.id);
    expect(ids).toContain(thin.id);
    expect(rows.map((r) => r.slug)).not.toContain('size-below');
    expect(rows.map((r) => r.slug)).not.toContain('size-above');
  });

  it('filters by the occupied footprint, not the declared canvas (#55)', async () => {
    // Same 21×22 canvas as every other size test's worked example, but a
    // small occupied footprint — must NOT match a size filter for ~462 tiles
    // even though cols*rows would.
    const canvasOnly = await insertLayout(harness.db, {
      slug: 'size-canvas-only',
      cols: 21,
      rows: 22,
      visibleCols: 5,
      visibleRows: 5,
    });
    const trulyBig = await insertLayout(harness.db, {
      slug: 'size-truly-big',
      cols: 21,
      rows: 22,
      visibleCols: 21,
      visibleRows: 22,
    });

    const { rows } = await listLayouts(harness.db, {
      filters: { size: { min: 462, max: 462 } },
      sort: 'newest',
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(trulyBig.id);
    expect(ids).not.toContain(canvasOnly.id);
  });

  it('filters by seat count range, inclusive at both ends', async () => {
    const exact = await insertLayout(harness.db, { slug: 'seats-exact', seatCount: 20 });
    await insertLayout(harness.db, { slug: 'seats-below', seatCount: 19 });
    await insertLayout(harness.db, { slug: 'seats-above', seatCount: 21 });

    const { rows } = await listLayouts(harness.db, {
      filters: { seats: { min: 20, max: 20 } },
      sort: 'newest',
      limit: 100,
    });
    expect(rows.map((r) => r.id)).toContain(exact.id);
    expect(rows.map((r) => r.slug)).not.toContain('seats-below');
    expect(rows.map((r) => r.slug)).not.toContain('seats-above');
  });
});

describe('listLayouts — sorting', () => {
  it('newest sorts by createdAt descending', async () => {
    const a = await insertLayout(harness.db, { slug: 'sort-newest-a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await insertLayout(harness.db, { slug: 'sort-newest-b' });

    const { rows } = await listLayouts(harness.db, { filters: {}, sort: 'newest', limit: 2 });
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it('furniture sorts by furnitureCount descending', async () => {
    await insertLayout(harness.db, { slug: 'sort-furn-low', furnitureCount: 1 });
    await insertLayout(harness.db, { slug: 'sort-furn-high', furnitureCount: 99 });
    const { rows } = await listLayouts(harness.db, { filters: {}, sort: 'furniture', limit: 1 });
    expect(rows[0]?.slug).toBe('sort-furn-high');
  });

  it('largest sorts by visibleCols*visibleRows descending', async () => {
    await insertLayout(harness.db, {
      slug: 'sort-size-small',
      cols: 5,
      rows: 5,
      visibleCols: 5,
      visibleRows: 5,
    });
    await insertLayout(harness.db, {
      slug: 'sort-size-big',
      cols: 40,
      rows: 40,
      visibleCols: 40,
      visibleRows: 40,
    });
    const { rows } = await listLayouts(harness.db, { filters: {}, sort: 'largest', limit: 1 });
    expect(rows[0]?.slug).toBe('sort-size-big');
  });

  it('largest sorts by the occupied footprint, not the declared canvas (#55)', async () => {
    // Regression for #55: two rows share an identical 21×22 canvas, but very
    // different actual footprints — the one that is genuinely bigger must win.
    // Scoped to a unique tag (rather than an unfiltered `limit: 1`, which
    // would just find whichever row this whole suite happened to make
    // biggest) so the assertion only depends on these two rows' relative order.
    const canvasOnly = await insertLayout(harness.db, {
      slug: 'sort-canvas-only',
      cols: 21,
      rows: 22,
      visibleCols: 5,
      visibleRows: 5,
    });
    await tagLayout(harness.db, canvasOnly.id, 'sort-canvas-regression');
    const trulyBig = await insertLayout(harness.db, {
      slug: 'sort-truly-big',
      cols: 21,
      rows: 22,
      visibleCols: 20,
      visibleRows: 21,
    });
    await tagLayout(harness.db, trulyBig.id, 'sort-canvas-regression');

    const { rows } = await listLayouts(harness.db, {
      filters: { tags: ['sort-canvas-regression'] },
      sort: 'largest',
      limit: 2,
    });
    expect(rows.map((r) => r.id)).toEqual([trulyBig.id, canvasOnly.id]);
  });

  it('title sorts alphabetically ascending', async () => {
    await insertLayout(harness.db, { slug: 'sort-title-z', title: 'Zebra Office' });
    await insertLayout(harness.db, { slug: 'sort-title-a', title: 'Aardvark Office' });
    const { rows } = await listLayouts(harness.db, { filters: {}, sort: 'title', limit: 1 });
    expect(rows[0]?.slug).toBe('sort-title-a');
  });
});

describe('listLayouts — keyset pagination', () => {
  it('pages through every row exactly once, in order', async () => {
    // A sentinel base far outside every other test's furniture counts in this
    // file (all single or triple digits), so the range filter below cannot
    // accidentally capture rows this test did not insert.
    const BASE = 8000;
    for (let i = 0; i < 5; i += 1) {
      await insertLayout(harness.db, { slug: `page-seq-${i}`, furnitureCount: BASE + i });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listLayouts(harness.db, {
        filters: { furniture: { min: BASE, max: BASE + 4 } },
        sort: 'furniture',
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.rows.map((r) => r.slug));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual(['page-seq-4', 'page-seq-3', 'page-seq-2', 'page-seq-1', 'page-seq-0']);
  });

  it('is stable when a new row is inserted between two page requests', async () => {
    // The property OFFSET pagination cannot give you: a row inserted at the
    // front of the order between requests must not shift page 2's contents.
    //
    // A sentinel base disjoint from every other test's furnitureCount in this
    // file: a collision (e.g. sharing 99 with another test's row) would make
    // the tiebreak between same-count rows depend on random UUID ordering
    // across unrelated tests — a flaky test masquerading as a passing one.
    const BASE = 90_000;
    const first = await insertLayout(harness.db, { slug: 'stable-a', furnitureCount: BASE + 100 });
    const second = await insertLayout(harness.db, { slug: 'stable-b', furnitureCount: BASE + 99 });

    const page1 = await listLayouts(harness.db, {
      filters: { furniture: { min: BASE } },
      sort: 'furniture',
      limit: 1,
    });
    expect(page1.rows[0]?.id).toBe(first.id);
    // assert, not expect(...).toBeTruthy(): only the former narrows, which is
    // what the cursor below needs.
    assert(page1.nextCursor !== null);

    // A brand new highest-furniture row lands "before" page 1 in sort order.
    await insertLayout(harness.db, { slug: 'stable-inserted-later', furnitureCount: BASE + 1000 });

    const page2 = await listLayouts(harness.db, {
      filters: { furniture: { min: BASE } },
      sort: 'furniture',
      limit: 1,
      cursor: page1.nextCursor,
    });
    expect(page2.rows[0]?.id).toBe(second.id);
  });

  it('total reflects every matching row, independent of the page size', async () => {
    for (let i = 0; i < 3; i += 1) {
      await insertLayout(harness.db, { slug: `total-check-${i}`, furnitureCount: 500 + i });
    }
    const { total } = await listLayouts(harness.db, {
      filters: { furniture: { min: 500, max: 502 } },
      sort: 'newest',
      limit: 1,
    });
    expect(total).toBe(3);
  });

  it('a cursor for the wrong sort is ignored rather than corrupting results', async () => {
    await insertLayout(harness.db, { slug: 'cursor-mismatch', furnitureCount: 7 });
    const wrongCursor = Buffer.from(
      JSON.stringify({ sort: 'title', value: 'Z', id: 'nonexistent' }),
      'utf-8',
    ).toString('base64url');

    const { rows } = await listLayouts(harness.db, {
      filters: {},
      sort: 'furniture',
      limit: 100,
      cursor: wrongCursor,
    });
    expect(rows.map((r) => r.slug)).toContain('cursor-mismatch');
  });
});

describe('tagsForLayouts', () => {
  it('groups tags per layout and returns an empty array for one with none', async () => {
    const withTags = await insertLayout(harness.db, { slug: 'tagged-lookup' });
    await tagLayout(harness.db, withTags.id, 'alpha');
    await tagLayout(harness.db, withTags.id, 'beta');
    const untagged = await insertLayout(harness.db, { slug: 'untagged-lookup' });

    const map = await tagsForLayouts(harness.db, [withTags.id, untagged.id]);
    expect(new Set(map.get(withTags.id))).toEqual(new Set(['alpha', 'beta']));
    expect(map.get(untagged.id)).toEqual([]);
  });

  it('returns an empty map for an empty input rather than querying', async () => {
    expect(await tagsForLayouts(harness.db, [])).toEqual(new Map());
  });
});

describe('author display', () => {
  it('a seed-style layout (authorDisplay set) is not tied to a real account in the schema', async () => {
    // The public-facing mapping (author.id -> null) lives in serialize.ts;
    // this just confirms the data shape it works from.
    const layout = await insertLayout(harness.db, {
      slug: 'seed-style',
      authorDisplay: 'pablodelucca',
    });
    const [row] = await harness.db.select().from(schema.layouts).where(eq(schema.layouts.id, layout.id));
    expect(row?.authorDisplay).toBe('pablodelucca');
  });
});
