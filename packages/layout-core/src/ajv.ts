/**
 * The one place that knows how to load `ajv-formats`.
 *
 * The package is CJS. Its entry does both `module.exports = formatsPlugin` and
 * `exports.default = formatsPlugin`, while its `.d.ts` declares only an ES
 * default export. Under NodeNext those disagree and TypeScript binds the
 * namespace object rather than the callable, so the function has to be
 * recovered from whichever shape actually arrived — which cannot be expressed
 * without an assertion.
 *
 * Two of them, written twice: this file existed as a copy in `validate.ts` and
 * another in the API's `layouts/routes.test.ts`, whose comment pointed here
 * because there was nothing to import. Now there is, and when `ajv-formats`
 * ships correct ESM types there is one thing to delete.
 *
 * Typed against `AjvCore` rather than a dialect: layout-core validates with
 * 2020-12 and the API's response-schema tests use draft-07. Both extend it.
 */

import addFormatsExport from 'ajv-formats';

/**
 * `import type AjvCore from 'ajv/dist/core.js'` binds the module namespace
 * rather than the default class under NodeNext, the same CJS/ESM disagreement
 * this file exists to absorb. The import type expression names the class
 * directly and is not subject to it.
 */
type AjvCore = import('ajv/dist/core.js').default;

type AddFormats = (ajv: AjvCore) => unknown;

const addFormats: AddFormats =
  (addFormatsExport as unknown as { default?: AddFormats }).default ??
  (addFormatsExport as unknown as AddFormats);

/** Registers ajv-formats on `ajv` and hands it back, for chaining. */
export function withFormats<T extends AjvCore>(ajv: T): T {
  addFormats(ajv);
  return ajv;
}
