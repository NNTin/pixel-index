/**
 * @pixel-index/layout-core — skeleton.
 *
 * The real implementation is extracted from tools/validate.mjs and
 * tools/lib/layouts.mjs by https://github.com/NNTin/pixel-index/issues/2.
 * Until then v1's tooling remains the working validator; nothing imports this.
 *
 * Exporting the intended surface as explicit stubs (rather than leaving the file
 * empty) keeps the workspace resolvable and makes a premature import fail loudly
 * instead of silently resolving to undefined.
 */

const notYet = (name) => () => {
  throw new Error(
    `@pixel-index/layout-core: ${name}() is not implemented yet — see issue #2. ` +
      'Use tools/validate.mjs until the extraction lands.',
  );
};

export const validateLayout = notYet('validateLayout');
export const validateMeta = notYet('validateMeta');
export const layoutStats = notYet('layoutStats');
export const furnitureCatalog = notYet('furnitureCatalog');
export const bundledLayoutRevision = notYet('bundledLayoutRevision');
export const sha256 = notYet('sha256');
