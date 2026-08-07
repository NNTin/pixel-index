/**
 * Disk conventions for the v1 static index.
 *
 * Everything that knows what a *valid layout* is has moved to
 * @pixel-index/layout-core, so the API and the renderer can share it. What is
 * left here is the part that is specific to v1's on-disk shape
 * (`layouts/<slug>/{layout,meta}.json`), which is on its way to `seed/` (#18).
 *
 * The upstream lookups are re-exported rather than reimplemented so the build
 * tools and the validator can never disagree about the pinned Pixel Agents.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonOrNull, resolveUpstreamDir } from '@pixel-index/layout-core';

export {
  bundledLayoutRevision,
  furnitureCatalog,
  layoutStats,
  readJsonOrNull,
  sha256,
  upstreamPin,
} from '@pixel-index/layout-core';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LAYOUTS_DIR = path.join(REPO_ROOT, 'layouts');
export const UPSTREAM_DIR = resolveUpstreamDir();
export const UPSTREAM_ASSETS = path.join(UPSTREAM_DIR, 'webview-ui/public/assets');
export const DIST_DIR = path.join(REPO_ROOT, 'dist');

/** Slug -> { slug, dir, layout, meta } for every layout in the repo. */
export function readLayouts() {
  if (!fs.existsSync(LAYOUTS_DIR)) return [];
  return fs
    .readdirSync(LAYOUTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((slug) => {
      const dir = path.join(LAYOUTS_DIR, slug);
      return {
        slug,
        dir,
        layoutPath: path.join(dir, 'layout.json'),
        metaPath: path.join(dir, 'meta.json'),
        layout: readJsonOrNull(path.join(dir, 'layout.json')),
        meta: readJsonOrNull(path.join(dir, 'meta.json')),
      };
    });
}
