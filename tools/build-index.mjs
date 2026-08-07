#!/usr/bin/env node
/**
 * Build dist/index.json — the machine-readable index — and stage every layout
 * for download alongside it.
 *
 * Consumers fetch one file and get everything they need to render a gallery or
 * install a layout: metadata, dimensions, the upstream version each layout was
 * validated against, and content hashes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DIST_DIR, layoutStats, readLayouts, sha256, upstreamPin } from './lib/layouts.mjs';

const INDEX_SCHEMA_VERSION = 1;

const layouts = readLayouts();
if (layouts.length === 0) {
  console.error('No layouts found under layouts/.');
  process.exit(1);
}

const pin = upstreamPin();
const layoutsOut = path.join(DIST_DIR, 'layouts');
fs.mkdirSync(layoutsOut, { recursive: true });

const entries = layouts.map(({ slug, layout, meta, layoutPath }) => {
  const raw = fs.readFileSync(layoutPath);
  fs.writeFileSync(path.join(layoutsOut, `${slug}.json`), raw);

  return {
    slug,
    title: meta?.title ?? slug,
    author: meta?.author ?? 'unknown',
    description: meta?.description ?? '',
    tags: meta?.tags ?? [],
    ...(meta?.license ? { license: meta.license } : {}),
    ...(meta?.source ? { source: meta.source } : {}),
    ...layoutStats(layout),
    bytes: raw.length,
    sha256: sha256(raw),
    files: {
      layout: `layouts/${slug}.json`,
      preview: `previews/${slug}.png`,
    },
  };
});

const index = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  // Which Pixel Agents these layouts were validated and previewed against.
  // A consumer running an older build should treat a higher layoutRevision as
  // "this layout is newer than my Pixel Agents".
  pixelAgents: pin,
  count: entries.length,
  layouts: entries,
};

fs.writeFileSync(path.join(DIST_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

console.log(
  `Indexed ${entries.length} layout(s) against pixel-agents ${pin.version}` +
    `${pin.commit ? ` (${pin.commit.slice(0, 7)})` : ''}.`,
);
for (const entry of entries) {
  console.log(
    `  ${entry.slug.padEnd(20)} ${String(entry.cols).padStart(2)}x${String(entry.rows).padEnd(2)}` +
      `  furniture=${String(entry.furniture).padStart(3)}  ${(entry.bytes / 1024).toFixed(0)} kB`,
  );
}
