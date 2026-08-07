/**
 * Shared discovery + upstream lookups for the index tools.
 *
 * Everything that needs to know about the pinned Pixel Agents checkout goes
 * through here, so `vendor/pixel-agents` is referenced in exactly one place.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LAYOUTS_DIR = path.join(REPO_ROOT, 'layouts');
export const UPSTREAM_DIR = path.join(REPO_ROOT, 'vendor/pixel-agents');
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

export function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function assertUpstream() {
  if (!fs.existsSync(path.join(UPSTREAM_DIR, 'package.json'))) {
    throw new Error(
      'vendor/pixel-agents is empty. Run: git submodule update --init --recursive',
    );
  }
}

/**
 * The revision of the default layout bundled with the pinned upstream.
 *
 * This is the number every published layout is measured against: Pixel Agents
 * throws away a stored layout whose revision is BELOW the bundled default's
 * (server/src/layoutPersistence.ts), so a layout published under this number is
 * one that silently resets on the user's next start.
 */
export function bundledLayoutRevision() {
  assertUpstream();
  const files = fs
    .readdirSync(UPSTREAM_ASSETS)
    .map((file) => /^default-layout-(\d+)\.json$/.exec(file))
    .filter(Boolean)
    .map((match) => ({ revision: Number(match[1]), file: match[0] }))
    .sort((a, b) => b.revision - a.revision);
  if (files.length === 0) return 0;
  const layout = readJsonOrNull(path.join(UPSTREAM_ASSETS, files[0].file));
  return layout?.layoutRevision ?? files[0].revision;
}

/** Properties that a manifest group passes down to its members. */
const INHERITED_PROPS = [
  'category',
  'canPlaceOnWalls',
  'canPlaceOnSurfaces',
  'backgroundTiles',
  'footprintW',
  'footprintH',
];

/**
 * Every furniture id the pinned upstream can draw, as id -> placement props.
 *
 * Two shapes have to be handled or valid layouts get flagged:
 *
 * - Manifests are trees. `canPlaceOnWalls` and the footprint often sit on the
 *   group root and are inherited by the leaf assets (see PC, CLOCK).
 * - `mirrorSide` assets with orientation "side" gain a virtual `<id>:left`
 *   entry in the catalog, and layouts store that id verbatim
 *   (webview-ui/src/office/layout/furnitureCatalog.ts).
 */
export function furnitureCatalog() {
  assertUpstream();
  const furnitureDir = path.join(UPSTREAM_ASSETS, 'furniture');
  const catalog = new Map();
  if (!fs.existsSync(furnitureDir)) return catalog;

  for (const entry of fs.readdirSync(furnitureDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readJsonOrNull(path.join(furnitureDir, entry.name, 'manifest.json'));
    if (manifest) walkManifest(manifest, {}, catalog);
  }

  for (const [id, props] of [...catalog]) {
    if (props.mirrorSide && props.orientation === 'side') {
      catalog.set(`${id}:left`, { ...props, orientation: 'left' });
    }
  }
  return catalog;
}

function walkManifest(node, inherited, catalog) {
  if (!node || typeof node !== 'object') return;

  const props = { ...inherited };
  for (const key of INHERITED_PROPS) {
    if (node[key] !== undefined) props[key] = node[key];
  }

  if (node.type === 'asset' && typeof node.id === 'string') {
    catalog.set(node.id, {
      ...props,
      orientation: node.orientation ?? inherited.orientation,
      mirrorSide: node.mirrorSide ?? false,
    });
    return;
  }

  // Orientation and state are set on intermediate groups too, and members
  // inherit whatever their enclosing group declared.
  if (node.orientation !== undefined) props.orientation = node.orientation;

  for (const member of node.members ?? []) {
    walkManifest(member, props, catalog);
  }
}

/** Convenience for callers that only need membership. */
export function knownFurnitureIds() {
  return new Set(furnitureCatalog().keys());
}

export function upstreamPin() {
  assertUpstream();
  const pkg = readJsonOrNull(path.join(UPSTREAM_DIR, 'package.json'));
  // Ask git rather than reading .git/HEAD: this repo may itself be a submodule,
  // in which case the gitdir lives somewhere else entirely.
  let commit = null;
  try {
    commit = execFileSync('git', ['-C', UPSTREAM_DIR, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    /* not a git checkout (e.g. a release tarball) — version alone will do */
  }
  return {
    version: pkg?.version ?? null,
    commit: /^[0-9a-f]{40}$/.test(commit ?? '') ? commit : null,
    layoutRevision: bundledLayoutRevision(),
  };
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function layoutStats(layout) {
  return {
    cols: layout.cols,
    rows: layout.rows,
    furniture: layout.furniture?.length ?? 0,
    areas: layout.areas?.length ?? 0,
    pets: layout.pets?.length ?? 0,
    carpets: layout.carpets?.length ?? 0,
    layoutRevision: layout.layoutRevision ?? 0,
  };
}
