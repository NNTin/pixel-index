import type { Layout } from '../types.js';

/**
 * Overrides for {@link makeLayout}. Passing `undefined` for a key is how a test
 * says "this layout does not have that key at all" — several tests do exactly
 * that to prove absent collections and an absent `layoutRevision` are handled.
 * Spelled out rather than `Partial<Layout>` because exactOptionalPropertyTypes
 * makes `Partial<Layout>` reject an explicit `undefined`.
 */
type LayoutOverrides = { [K in keyof Layout]?: Layout[K] | undefined };

/**
 * A minimal layout that passes every check, as a base for tests to break in one
 * specific way. `layoutRevision` matches the pinned upstream's bundled default.
 */
export function makeLayout(overrides: LayoutOverrides = {}): Layout {
  const base: Layout = {
    version: 1,
    layoutRevision: 1,
    cols: 2,
    rows: 2,
    tiles: [0, 0, 0, 0],
    furniture: [],
  };

  // An `undefined` override deletes the key rather than setting it to
  // undefined, so the fixture produces the same shape a real exported layout
  // with that field missing has — which is what those tests mean to exercise.
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(base, key);
    else Object.assign(base, { [key]: value });
  }

  return base;
}

export const codesOf = (issues: { code: string }[]): string[] => issues.map((i) => i.code);
