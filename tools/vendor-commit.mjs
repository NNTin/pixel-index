#!/usr/bin/env node
/**
 * Keep `vendor/pixel-agents.commit` equal to the submodule pin.
 *
 *   node tools/vendor-commit.mjs           # write it
 *   node tools/vendor-commit.mjs --check    # verify it, exit 1 if it drifted
 *
 * ## Why a committed file at all
 *
 * A container cannot work out which upstream it holds. `vendor/pixel-agents/.git`
 * is a gitdir *pointer* whose target sits outside the Docker build context — and
 * under a git worktree it is an absolute path on the build machine — so no amount
 * of copying lets the image resolve its own pin. That used to be papered over with
 * a `PIXEL_AGENTS_COMMIT` build argument, which nobody remembered to pass, so
 * every deployed image reported `commit: null`.
 *
 * The source of truth is the gitlink in the parent repo's tree, which is what
 * `git ls-tree` reads here — deliberately not `git -C vendor/pixel-agents rev-parse
 * HEAD`. The gitlink is what a fresh clone would check out, and it is readable
 * even when the submodule has never been initialised; `rev-parse` reports whatever
 * the working copy happens to be sitting on, which during a bump is briefly not
 * the same thing.
 *
 * `--check` runs in CI so the file cannot silently drift from the pin it claims
 * to describe. That check is what makes the file trustworthy enough to ship.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUBMODULE = 'vendor/pixel-agents';
const STAMP = path.join(REPO_ROOT, `${SUBMODULE}.commit`);

/** The pinned commit, from the parent repo's tree. */
function pinnedCommit() {
  const line = execFileSync('git', ['ls-tree', 'HEAD', SUBMODULE], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  }).trim();

  // "160000 commit <sha>\tvendor/pixel-agents"
  const match = /^160000 commit ([0-9a-f]{40})\t/.exec(line);
  if (!match) {
    throw new Error(
      `Could not read the ${SUBMODULE} gitlink from git ls-tree. Got: ${JSON.stringify(line)}`,
    );
  }
  return match[1];
}

const check = process.argv.includes('--check');
const pinned = pinnedCommit();
const current = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, 'utf-8').trim() : null;

if (check) {
  if (current === pinned) {
    console.log(`vendor/pixel-agents.commit matches the pin (${pinned.slice(0, 7)}).`);
    process.exit(0);
  }
  console.error(
    `vendor/pixel-agents.commit is ${current ?? 'missing'}, but the submodule pins ${pinned}.\n` +
      'Run: npm run vendor:commit',
  );
  process.exit(1);
}

fs.writeFileSync(STAMP, `${pinned}\n`);
console.log(
  current === pinned
    ? `vendor/pixel-agents.commit already at ${pinned.slice(0, 7)}.`
    : `vendor/pixel-agents.commit -> ${pinned.slice(0, 7)}.`,
);
