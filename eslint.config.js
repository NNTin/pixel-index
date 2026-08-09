import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole repository.
 *
 * It used to be one config for apps/web and nothing at all for
 * packages/layout-core, services/api, services/renderer and tools/ — which is
 * to say the two services holding every request handler, every SQL query and
 * every browser were the parts nobody linted. Four sibling configs would have
 * drifted the same way the four tsconfigs did (see tsconfig.strict.json), so
 * this is deliberately a single file with per-area overrides rather than a
 * shared preset each workspace re-exports.
 *
 * ESLint 10 resolves the config from the linted file upward, so `eslint .` from
 * a workspace directory finds this file and lints only that workspace — the
 * per-workspace `lint` scripts stay useful without a config of their own.
 */

/**
 * A leading underscore means "deliberately unused" — the convention this
 * codebase already used (`_request` in a content-type parser it does not read,
 * `_canvasBox` in the rest-destructure that drops a key) before anything
 * enforced it. Spelling the patterns out is what makes the convention load-
 * bearing instead of decorative; without them the rule's answer to "how do I
 * say I meant it?" is an eslint-disable comment, which is worse.
 */
const unusedVarsWithUnderscoreEscape = {
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
};

/** Rules from recommendedTypeChecked this repository deliberately does not run. */
const declinedTypeCheckedRules = {
  /**
   * `async` is a contract here, not a smell: Fastify route handlers are
   * declared async so the framework awaits their return value, `vi.fn(async
   * () => new Response(...))` has to match `typeof fetch`, and the harness's
   * `startDevServer`/`createRenderer` fakes have to match interfaces whose
   * members return promises. Dropping `async` from any of those means hand-
   * rolling `Promise.resolve`, which is strictly worse code. 75 reports, none
   * of them a type weakness.
   */
  '@typescript-eslint/require-await': 'off',
};

/**
 * Rules from strictTypeChecked that are worth their cost. The rest of that
 * preset is not enabled: restrict-template-expressions is here in a relaxed
 * form (below), while no-non-null-assertion (77 reports) and
 * no-confusing-void-expression (67) are style-or-refactor work that would
 * bury the type fixes in #44. See the PR for the per-rule counts.
 *
 * Also declined: no-unnecessary-type-parameters. Its one finding here is
 * layout-core's `readJsonOrNull<T>(file)` — a deliberate "parse this untrusted
 * file as T" helper, the same shape as Fastify's own `response.json<T>()`. The
 * rule is right that T is an assertion in disguise; it is a useful disguise,
 * because the alternative is a bare `as` at all five call sites.
 */
const extraStrictRules = {
  /**
   * The rule that catches `[object Object]` reaching a user. Numbers and
   * booleans in templates are fine and intended all over this codebase
   * (`${count} layouts`), so those are allowed; objects, unions and `any` are
   * not. Relaxed this way it costs nothing today and still guards the real
   * failure — the sibling no-base-to-string (in recommendedTypeChecked) found
   * 20 live cases of exactly that.
   */
  '@typescript-eslint/restrict-template-expressions': [
    'error',
    { allowNumber: true, allowBoolean: true },
  ],

  /** A condition whose answer the types already know is either dead code or a wrong type. */
  '@typescript-eslint/no-unnecessary-condition': 'error',

  /** Adding a variant to a union should break every switch that has to handle it. */
  '@typescript-eslint/switch-exhaustiveness-check': 'error',

  '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
  '@typescript-eslint/no-useless-default-assignment': 'error',
  '@typescript-eslint/no-misused-spread': 'error',
  '@typescript-eslint/restrict-plus-operands': 'error',
  /**
   * Not for strings. `??` and `||` genuinely differ there — the empty string is
   * falsy but not nullish — and this codebase depends on the difference: an
   * unset GitHub Actions repo variable interpolates to `''`, and
   * `import.meta.env.VITE_API_BASE_URL || fallback` is what stops that becoming
   * a same-origin request against the Pages domain (apps/web/src/api/client.ts).
   */
  '@typescript-eslint/prefer-nullish-coalescing': [
    'error',
    { ignorePrimitives: { string: true } },
  ],
  /**
   * Default `in-try-catch` rather than `always`: the only place the missing
   * `await` changes behaviour is a returned promise inside a try, where
   * omitting it means the catch never sees the rejection. Requiring it
   * everywhere would be 52 more edits that change nothing.
   */
  '@typescript-eslint/return-await': 'error',

  /** Upstream deprecations should surface here, not in a runtime break after a bump. */
  '@typescript-eslint/no-deprecated': 'error',
};

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    // The pinned upstream. Not ours to edit, and its own repo lints it.
    'vendor/**',
    '**/test-results/**',
    '**/.mermaid-fixtures/**',
  ]),

  // ---------------------------------------------------------------- plain JS
  // tools/ and the two e2e drivers are hand-written .mjs with no build step,
  // so they get the untyped baseline rather than the type-aware one.
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    // Drives a real Chromium: the page.evaluate callbacks are browser code
    // living inside a Node script, so both global sets are in scope.
    files: ['apps/web/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // ------------------------------------------------------- TypeScript, typed
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      // projectService reads each file's nearest tsconfig, so the lint sees
      // exactly the types the workspace's own typecheck sees — including
      // apps/web's solution-style config with its three referenced projects.
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      ...declinedTypeCheckedRules,
      ...extraStrictRules,
      ...unusedVarsWithUnderscoreEscape,
    },
  },

  // --------------------------------------------------------------- apps/web
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      /**
       * Off in the browser only. It earns its keep in the services — it is what
       * caught three route handlers claiming `request.body` is always an object
       * when an empty POST really does arrive as undefined — but every one of
       * its seven reports here was a false positive, from two causes it cannot
       * see past:
       *
       * - lib.dom overstates what exists. `window.matchMedia` and
       *   `navigator.clipboard` are non-optional in the types and genuinely
       *   absent in jsdom and in an insecure context; the guards around them
       *   are the reason those paths work.
       * - TypeScript cannot follow a captured cancellation flag. `let cancelled
       *   = false`, reassigned in the effect's *cleanup*, narrows to `false`
       *   inside the async body — so the `if (cancelled) return` that stops a
       *   resolved fetch writing to an unmounted component reads as dead code.
       *   That idiom is used in four effects here and is not negotiable.
       */
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    // Build-time code in the SPA workspace: Node, not a browser.
    files: ['apps/web/{vite,vitest}.config.ts', 'apps/web/build/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  eslintConfigPrettier,
]);
