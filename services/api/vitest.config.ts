import { defineConfig } from 'vitest/config';

/**
 * Timeouts sized to this suite's actual unit of work.
 *
 * Almost every file here boots a real Postgres — PGlite, the engine compiled to
 * WASM — because the schema's behaviour (triggers, generated tsvector columns,
 * partial indexes, check constraints) is the thing under test and a mock would
 * prove none of it. Measured on an idle 8-core machine, `createTestDatabase()`
 * costs ~1050ms: migrations against a genuine engine, not a fixture load.
 *
 * Vitest's defaults are 5000ms per test and 10000ms per hook, which are
 * sensible numbers for tests whose unit of work is a function call. Against a
 * one-second database they leave a single-digit multiple of headroom, and that
 * is what this suite kept exhausting — not because anything was wrong, but
 * because a developer machine running several workspaces at once, or a small CI
 * runner, takes two or three times as long to do the same work. The failure was
 * always a timeout on setup, never a wrong assertion.
 *
 * 30s is ~30x the idle cost. It is still a real limit: a hung query or a
 * deadlock fails here rather than running forever, which is the only thing a
 * timeout is for. Raising it further would start hiding those.
 *
 * Deliberately *not* changed: worker concurrency. Each worker holds its own
 * WASM Postgres, so capping workers would make saturation less likely — at the
 * cost of slowing the suite everywhere, including CI, where it is not a problem.
 * The timeout is the honest knob; concurrency is a machine-sizing question.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
