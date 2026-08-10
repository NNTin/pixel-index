import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
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
 *
 * The bar is `strictTypeChecked` + `stylisticTypeChecked` in full, minus the
 * exceptions below. It used to be `recommendedTypeChecked` plus a hand-picked
 * list of ten extra rules, which had two problems: a rule the presets add in a
 * future typescript-eslint release lands nowhere, and three rules were declined
 * for their report counts rather than for anything about the rules. Measured
 * before the switch, 35 of the rules the two presets add were already at zero
 * here — so the allow-list was mostly recording work already done.
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

/**
 * Where this repository departs from the two presets.
 *
 * Every entry states what the rule is worth, not how many times it fires. A
 * count is a fact about today's code; it is not a reason, and the moment it is
 * written down it starts going stale (the previous version of this file claimed
 * `no-unnecessary-type-parameters` had "one finding" when it had three).
 */
const presetExceptions = {
  /**
   * OFF. It prescribes exactly the syntax `no-non-null-assertion` forbids —
   * every one of its reports reads "use a ! assertion to more succinctly remove
   * null and undefined" — and its autofix would undo that rule's work. The two
   * presets genuinely disagree here and this is the side we take: an assertion
   * is an assertion whether it is spelled `!` or `as NonNullable<T>`, and the
   * fix for both is a check that can fail.
   */
  '@typescript-eslint/non-nullable-type-assertion-style': 'off',

  /**
   * Not for strings. `??` and `||` genuinely differ there — the empty string is
   * falsy but not nullish — and this codebase depends on the difference: an
   * unset GitHub Actions repo variable interpolates to `''`, and
   * `import.meta.env.VITE_API_BASE_URL || fallback` is what stops that becoming
   * a same-origin request against the Pages domain (apps/web/src/api/client.ts).
   */
  '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],

  /**
   * Stricter than the preset's `error-handling-correctness-only`. The only
   * place a missing `await` changes behaviour is a returned promise inside a
   * try, where omitting it means the catch never sees the rejection — and
   * `in-try-catch` (the default) is the setting that says exactly that.
   */
  '@typescript-eslint/return-await': 'error',

  /**
   * The rule that catches `[object Object]` reaching a user. Numbers and
   * booleans in templates are fine and intended all over this codebase
   * (`${count} layouts`); objects, unions, `any`, `never`, regexps and nullish
   * values are not.
   *
   * The four explicit `false`s are the point. This entry used to read
   * `{ allowNumber: true, allowBoolean: true }` above a comment claiming
   * "objects, unions and `any` are not [allowed]" — which was false, because
   * the rule's own defaults are permissive and left `allowAny`, `allowNullish`,
   * `allowNever` and `allowRegExp` all on. `${maybeUndefined}` rendering the
   * literal text "undefined" into a redirect URL passed the lint for months.
   */
  '@typescript-eslint/restrict-template-expressions': [
    'error',
    {
      allowNumber: true,
      allowBoolean: true,
      allowAny: false,
      allowNullish: false,
      allowNever: false,
      allowRegExp: false,
    },
  ],

  /**
   * `onClick={() => setOpen(true)}` is idiomatic React, not a confusing void
   * expression, and it was ~58 of this rule's 60 reports. What survives is the
   * payload: a void value flowing somewhere it will actually be read.
   */
  '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],

  /**
   * `T[]`, the default. Measured both ways before choosing: `array` reports 4
   * sites and `array-simple` reports 11, so `T[]` is what this codebase already
   * converged on for simple and compound types alike.
   */
  '@typescript-eslint/array-type': ['error', { default: 'array' }],

  // --- Turned on by later commits in this series, once their fixes land. ---
  // Kept off here only so every commit is green; both entries are deleted
  // before the branch is pushed.
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/require-await': 'off',
};

/**
 * Correctness rules from core ESLint, beyond `js.configs.recommended`.
 *
 * All of these were measured at zero across every workspace *and* tools/, so
 * they cost nothing today and exist to catch the next occurrence. They live in
 * the shared block rather than the typed one because the untyped `.mjs` files
 * are exactly where a stray `==` is least likely to be noticed.
 *
 * Not here, and deliberately: `consistent-return` (17 reports — `noImplicitReturns`
 * in tsconfig.strict.json already governs the real case), `no-await-in-loop`
 * (16, every one a deliberately sequential loop), `require-atomic-updates` and
 * `no-promise-executor-return` (false-positive prone; the sites are
 * `new Promise((resolve) => setTimeout(resolve, 0))`), and taste rules such as
 * `no-else-return` that decide nothing.
 */
const coreCorrectnessRules = {
  eqeqeq: ['error', 'always'],
  'array-callback-return': 'error',
  'no-self-compare': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-template-curly-in-string': 'error',
  'default-case-last': 'error',
  'no-param-reassign': 'error',
  'no-implicit-coercion': 'error',
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
  // so they get the untyped baseline rather than the type-aware one. Bringing
  // them under `checkJs` was measured at 30 errors plus a new @types/jsdom
  // dependency — a typechecking expansion, not a lint one, and its own issue.
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
      ...coreCorrectnessRules,
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
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
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
      /**
       * Property-style signatures are checked covariantly under
       * strictFunctionTypes; method shorthand is bivariant, which is how a
       * stub that accepts less than the interface promises slips through. A
       * type-safety rule wearing a style rule's name.
       */
      '@typescript-eslint/method-signature-style': 'error',
      ...coreCorrectnessRules,
      ...presetExceptions,
      ...unusedVarsWithUnderscoreEscape,
    },
  },

  // --------------------------------------------------------------- apps/web
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    // Build-time code in the SPA workspace: Node, not a browser.
    files: ['apps/web/{vite,vitest}.config.ts', 'apps/web/build/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
]);
