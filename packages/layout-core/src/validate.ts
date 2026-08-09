/**
 * What counts as a valid layout.
 *
 * Validation is deliberately two-layered:
 *
 *   1. **Structure**, from JSON Schema — types, required fields, ranges. Cheap,
 *      declarative, and publishable so contributors can check locally.
 *   2. **Semantics**, in code — the rules a schema cannot express because they
 *      are cross-field (tiles length is cols * rows) or depend on the pinned
 *      upstream (which furniture ids exist, what the bundled layoutRevision is).
 *
 * Everything is returned as data. Nothing here prints or exits: the API turns
 * these issues into a 422 body, the CLI formats them for a terminal.
 */

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsExport from 'ajv-formats';

import { layoutSchema, metaSchema } from './schemas.js';
import type { FurnitureCatalog, Layout, ValidationIssue, ValidationResult } from './types.js';
import { bundledLayoutRevision, furnitureCatalog } from './upstream.js';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** How many out-of-bounds items to name before truncating the message. */
const MAX_LISTED = 5;

/**
 * ajv-formats is CJS and its entry does both `module.exports = formatsPlugin`
 * and `exports.default = formatsPlugin`, while its .d.ts declares only an ES
 * default export. Under NodeNext those disagree and TypeScript binds the
 * namespace rather than the callable, so recover the function from either shape.
 */
type AddFormats = (ajv: Ajv2020) => unknown;
const addFormats: AddFormats =
  (addFormatsExport as unknown as { default?: AddFormats }).default ??
  (addFormatsExport as unknown as AddFormats);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const compiledLayout: ValidateFunction = ajv.compile(layoutSchema);
const compiledMeta: ValidateFunction = ajv.compile(metaSchema);

const result = (issues: ValidationIssue[]): ValidationResult => ({
  valid: issues.length === 0,
  issues,
});

function fromAjv(errors: ErrorObject[] | null | undefined, code: 'layout.schema' | 'meta.schema') {
  return (errors ?? []).map<ValidationIssue>((error) => ({
    code,
    path: error.instancePath || '/',
    message: `${error.instancePath || 'document'} ${error.message ?? 'is invalid'}`.trim(),
  }));
}

export function validateSlug(slug: string): ValidationResult {
  if (SLUG_RE.test(slug)) return result([]);
  return result([
    {
      code: 'slug.invalid',
      path: '/slug',
      message: `slug "${slug}" must be lowercase kebab-case (a-z, 0-9, hyphen) and start alphanumeric`,
    },
  ]);
}

export function validateMeta(meta: unknown): ValidationResult {
  if (meta === null || typeof meta !== 'object') {
    return result([
      { code: 'meta.invalid_json', path: '/', message: 'meta is not a JSON object' },
    ]);
  }
  return compiledMeta(meta) ? result([]) : result(fromAjv(compiledMeta.errors, 'meta.schema'));
}

export interface ValidateLayoutOptions {
  /** Defaults to the pinned upstream's catalog. Pass one to avoid re-reading it. */
  catalog?: FurnitureCatalog;
  /** Defaults to the pinned upstream's bundled default revision. */
  requiredRevision?: number;
  /** Only used to make the "unknown furniture" message actionable. */
  upstreamVersion?: string | null;
  /** Where the pinned upstream lives, when it is not auto-discoverable. */
  upstreamDir?: string;
}

/**
 * Full validation of one layout: structure, then the semantic rules.
 *
 * Semantic checks are skipped for fields the schema already rejected, so a
 * malformed document produces one clear error rather than a cascade.
 */
export function validateLayout(layout: unknown, options: ValidateLayoutOptions = {}): ValidationResult {
  if (layout === null || typeof layout !== 'object') {
    return result([
      { code: 'layout.invalid_json', path: '/', message: 'layout is not a JSON object' },
    ]);
  }

  const issues: ValidationIssue[] = [];
  if (!compiledLayout(layout)) {
    issues.push(...fromAjv(compiledLayout.errors, 'layout.schema'));
  }

  const doc = layout as Layout;
  const { cols, rows, tiles } = doc;
  const gridIsSane = Number.isInteger(cols) && Number.isInteger(rows);

  // ── Cross-field: the grid has to describe itself consistently ───────────
  if (gridIsSane && Array.isArray(tiles) && tiles.length !== cols * rows) {
    issues.push({
      code: 'layout.grid.tiles_mismatch',
      path: '/tiles',
      message: `tiles has ${tiles.length} entries, expected cols * rows = ${cols * rows}`,
    });
  }
  if (Array.isArray(doc.tileColors) && Array.isArray(tiles) && doc.tileColors.length !== tiles.length) {
    issues.push({
      code: 'layout.grid.tile_colors_mismatch',
      path: '/tileColors',
      message: `tileColors has ${doc.tileColors.length} entries, expected ${tiles.length} to match tiles`,
    });
  }

  // ── The rule that silently eats layouts ─────────────────────────────────
  const requiredRevision =
    options.requiredRevision ?? bundledLayoutRevision(options.upstreamDir);
  const revision = doc.layoutRevision ?? 0;
  if (revision < requiredRevision) {
    issues.push({
      code: 'layout.revision.below_bundled',
      path: '/layoutRevision',
      message:
        `layoutRevision ${revision} is below the bundled default's ${requiredRevision}. ` +
        'Pixel Agents resets any stored layout below the bundled revision, so this layout ' +
        'would be discarded on the next start. Re-export it against the pinned version.',
    });
  }

  // ── Furniture the pinned upstream cannot draw would render as a hole ─────
  const catalog = options.catalog ?? furnitureCatalog(options.upstreamDir);
  if (Array.isArray(doc.furniture) && catalog.size > 0) {
    const unknown = new Set<string>();
    const misplaced: string[] = [];

    for (const item of doc.furniture) {
      if (!item || typeof item.type !== 'string') continue;
      const entry = catalog.get(item.type);
      if (!entry) {
        unknown.add(item.type);
        continue;
      }
      if (!gridIsSane) continue;
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
      const version = options.upstreamVersion ? ` ${options.upstreamVersion}` : '';
      issues.push({
        code: 'layout.furniture.unknown',
        path: '/furniture',
        message: `unknown furniture for pixel-agents${version}: ${[...unknown].sort().join(', ')}`,
      });
    }
    if (misplaced.length > 0) {
      const shown = misplaced.slice(0, MAX_LISTED).join(', ');
      const more = misplaced.length > MAX_LISTED ? ` (+${misplaced.length - MAX_LISTED} more)` : '';
      issues.push({
        code: 'layout.furniture.out_of_bounds',
        path: '/furniture',
        message: `furniture outside the grid: ${shown}${more}`,
      });
    }
  }

  return result(issues);
}

export interface Validator {
  requiredRevision: number;
  catalog: FurnitureCatalog;
  validateLayout(layout: unknown): ValidationResult;
  validateMeta(meta: unknown): ValidationResult;
  validateSlug(slug: string): ValidationResult;
}

/**
 * Load the upstream catalog and revision once, then validate many layouts.
 *
 * Reading the furniture manifests walks the whole asset tree, so a server
 * validating every submission should never do it per request.
 */
export function createValidator(
  options: { upstreamDir?: string; upstreamVersion?: string | null } = {},
): Validator {
  const catalog = furnitureCatalog(options.upstreamDir);
  const requiredRevision = bundledLayoutRevision(options.upstreamDir);

  return {
    catalog,
    requiredRevision,
    validateLayout: (layout: unknown) =>
      validateLayout(layout, {
        catalog,
        requiredRevision,
        upstreamVersion: options.upstreamVersion ?? null,
      }),
    validateMeta,
    validateSlug,
  };
}
