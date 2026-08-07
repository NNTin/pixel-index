import type { Layout } from '../types.js';

/**
 * A minimal layout that passes every check, as a base for tests to break in one
 * specific way. `layoutRevision` matches the pinned upstream's bundled default.
 */
export function makeLayout(overrides: Partial<Layout> = {}): Layout {
  return {
    version: 1,
    layoutRevision: 1,
    cols: 2,
    rows: 2,
    tiles: [0, 0, 0, 0],
    furniture: [],
    ...overrides,
  };
}

export const codesOf = (issues: { code: string }[]): string[] => issues.map((i) => i.code);
