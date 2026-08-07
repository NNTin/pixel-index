#!/usr/bin/env node
/**
 * Validate every layout in the index against the pinned Pixel Agents checkout.
 *
 * Run on every pull request. The checks are the ones a contributor cannot
 * reasonably self-check: whether the grid is internally consistent, whether
 * every piece of furniture actually exists in the version of Pixel Agents we
 * pin, and whether the layout will survive being loaded at all.
 */

import * as fs from 'node:fs';

import {
  bundledLayoutRevision,
  furnitureCatalog,
  readLayouts,
  upstreamPin,
} from './lib/layouts.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const errors = [];

function error(slug, message) {
  errors.push(`${slug}: ${message}`);
}

const pin = upstreamPin();
const requiredRevision = bundledLayoutRevision();
const catalog = furnitureCatalog();
const layouts = readLayouts();

if (layouts.length === 0) {
  console.error('No layouts found under layouts/.');
  process.exit(1);
}

for (const { slug, layout, meta, layoutPath, metaPath } of layouts) {
  if (!SLUG_RE.test(slug)) {
    error(slug, 'folder name must be lowercase kebab-case (a-z, 0-9, hyphen)');
  }

  // ── meta.json ──────────────────────────────────────────────────────────
  if (!fs.existsSync(metaPath)) {
    error(slug, 'missing meta.json');
  } else if (!meta) {
    error(slug, 'meta.json is not valid JSON');
  } else {
    for (const field of ['title', 'author', 'description']) {
      if (typeof meta[field] !== 'string' || meta[field].trim() === '') {
        error(slug, `meta.json is missing "${field}"`);
      }
    }
    if (meta.tags && !Array.isArray(meta.tags)) {
      error(slug, 'meta.json "tags" must be an array');
    }
    for (const tag of meta.tags ?? []) {
      if (!SLUG_RE.test(tag)) error(slug, `tag "${tag}" must be lowercase kebab-case`);
    }
  }

  // ── layout.json ────────────────────────────────────────────────────────
  if (!fs.existsSync(layoutPath)) {
    error(slug, 'missing layout.json');
    continue;
  }
  if (!layout) {
    error(slug, 'layout.json is not valid JSON');
    continue;
  }

  if (layout.version !== 1) {
    error(slug, `unsupported layout version ${JSON.stringify(layout.version)} (expected 1)`);
  }

  const { cols, rows, tiles } = layout;
  if (!Number.isInteger(cols) || cols < 1 || cols > 64) {
    error(slug, `cols must be an integer 1-64, got ${JSON.stringify(cols)}`);
  }
  if (!Number.isInteger(rows) || rows < 1 || rows > 64) {
    error(slug, `rows must be an integer 1-64, got ${JSON.stringify(rows)}`);
  }
  if (!Array.isArray(tiles)) {
    error(slug, 'tiles must be an array');
  } else if (Number.isInteger(cols) && Number.isInteger(rows) && tiles.length !== cols * rows) {
    error(slug, `tiles has ${tiles.length} entries, expected cols * rows = ${cols * rows}`);
  }
  if (layout.tileColors && layout.tileColors.length !== tiles?.length) {
    error(
      slug,
      `tileColors has ${layout.tileColors.length} entries, expected ${tiles?.length} to match tiles`,
    );
  }

  // The rule that silently eats layouts. See lib/layouts.mjs.
  const revision = layout.layoutRevision ?? 0;
  if (revision < requiredRevision) {
    error(
      slug,
      `layoutRevision ${revision} is below the bundled default's ${requiredRevision}. ` +
        'Pixel Agents resets any stored layout below the bundled revision, so this layout ' +
        'would be discarded on the next start. Re-export it against the pinned version.',
    );
  }

  // Furniture the pinned upstream cannot draw would render as a hole.
  if (Array.isArray(layout.furniture) && catalog.size > 0) {
    const unknown = new Set();
    const misplaced = [];
    for (const item of layout.furniture) {
      if (!item || typeof item.type !== 'string') continue;
      const entry = catalog.get(item.type);
      if (!entry) {
        unknown.add(item.type);
        continue;
      }
      if (!Number.isInteger(item.col) || !Number.isInteger(item.row)) continue;

      // Wall-mounted furniture is anchored by its BOTTOM row, so a tall item on
      // the top wall legitimately sits at a negative row
      // (editorActions.ts getWallPlacementRow: row - (footprintH - 1)).
      const minRow = entry.canPlaceOnWalls ? -((entry.footprintH ?? 1) - 1) : 0;
      if (item.col < 0 || item.col >= cols || item.row < minRow || item.row >= rows) {
        misplaced.push(`"${item.type}" at (${item.col},${item.row})`);
      }
    }
    if (unknown.size > 0) {
      error(
        slug,
        `unknown furniture for pixel-agents ${pin.version}: ${[...unknown].sort().join(', ')}`,
      );
    }
    if (misplaced.length > 0) {
      error(slug, `furniture outside the grid: ${misplaced.slice(0, 5).join(', ')}`);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────
console.log(
  `Validated ${layouts.length} layout(s) against pixel-agents ${pin.version}` +
    `${pin.commit ? ` (${pin.commit.slice(0, 7)})` : ''}, bundled layoutRevision ${requiredRevision}.`,
);

for (const message of errors) console.error(`  error: ${message}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log('\nOK.');
