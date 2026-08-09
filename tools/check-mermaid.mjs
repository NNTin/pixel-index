#!/usr/bin/env node
/**
 * Parse every mermaid diagram in every versioned markdown file.
 *
 *   node tools/check-mermaid.mjs                  # all tracked markdown
 *   node tools/check-mermaid.mjs docs/FOO.md ...  # just these files
 *
 * Exits non-zero if any diagram fails to parse, after reporting *all* of them.
 * Exits zero when there is no mermaid to check.
 *
 * ## Why the parser and not the renderer
 *
 * The obvious tool is `@mermaid-js/mermaid-cli`, which renders each diagram
 * through Puppeteer. It is also a whole Chromium download in a job that has
 * nothing to render — this is a lint, and it should finish in seconds. mermaid
 * ships its own parser, and `mermaid.parse()` is exactly the syntax check we
 * want: it runs the real grammar for the real diagram type and throws the real
 * error message, with no layout, no fonts and no browser. A DOM shim (jsdom)
 * is enough to load it under Node. Every diagram type mermaid 11 knows —
 * flowchart, sequence, gantt, class, state, er, journey, gitGraph, mindmap,
 * timeline, quadrant, xychart, sankey, block, packet, architecture,
 * requirement, C4, radar, treemap — parses this way.
 *
 * What that trades away is render-time failures: a diagram whose *syntax* is
 * fine but which mermaid cannot lay out. Those are rare, and paying a browser
 * on every push to catch them is not the deal we want.
 *
 * ## Why the version is pinned exactly
 *
 * GitHub renders mermaid with its own pinned copy, so "valid mermaid" is only
 * meaningful relative to a version — a diagram using syntax newer than
 * github.com's will parse here and still show a red error box in the README.
 * `mermaid` is therefore pinned to an exact version in the root package.json,
 * deliberately behind the newest release: erring *older* than GitHub means new
 * syntax fails CI loudly (fix: bump the pin) rather than passing CI and
 * breaking silently on the site.
 *
 * To find out what GitHub actually runs, push a markdown file containing a
 * mermaid block whose entire body is the word `info` and look at the rendered
 * diagram — mermaid's `info` diagram prints its own version. Then set the pin
 * in package.json to that version, re-run this check, and fix whatever it
 * newly complains about in the same commit.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { extractMermaidBlocks } from './mermaid-blocks.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Markdown extensions GitHub renders mermaid in. */
const MARKDOWN_PATHSPECS = ['*.md', '*.markdown'];

/**
 * Every versioned markdown file, recursively.
 *
 * `git ls-files` *is* the definition of "versioned", which is why this does
 * not walk the tree itself: it needs no ignore list to skip node_modules and
 * build output, and it stops at the vendor/pixel-agents submodule boundary
 * (a gitlink is one entry, not a subtree) rather than validating upstream's
 * documentation for them. The pathspecs are unanchored, so they match at any
 * depth.
 *
 * @returns {string[]} repo-relative paths, sorted, so the report is stable.
 */
export function versionedMarkdownFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...MARKDOWN_PATHSPECS], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean).sort();
}

/**
 * Load mermaid under a DOM shim.
 *
 * mermaid is a browser library: importing it touches `document`, and several
 * diagram parsers reach for `window` (DOMPurify) on the way through. jsdom
 * supplies both. The globals are assigned rather than passed because mermaid
 * reads them off the global object at module scope.
 *
 * @returns {Promise<(code: string) => Promise<void>>} resolves for valid
 *   diagrams, rejects with mermaid's own error for invalid ones.
 */
export async function createParser() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });

  for (const key of [
    'window',
    'document',
    'navigator',
    'Element',
    'SVGElement',
    'HTMLElement',
    'Node',
    'DOMParser',
    'NodeFilter',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'MutationObserver',
    'CSS',
  ]) {
    if (globalThis[key] === undefined && dom.window[key] !== undefined) {
      globalThis[key] = dom.window[key];
    }
  }

  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false });
  return async (code) => {
    await mermaid.parse(code);
  };
}

/**
 * @typedef {object} Failure
 * @property {string} file     Repo-relative path.
 * @property {number} openLine 1-based line of the opening fence.
 * @property {number} line     1-based line the parser objected to, in the file.
 * @property {string} message  mermaid's own error message.
 */

/**
 * Where in the *file* mermaid's complaint lands.
 *
 * A jison parse error carries `hash.loc.first_line`, 1-based within the
 * diagram; anything else (an unknown diagram type, say) has no position, and
 * the block's first line is the best answer.
 */
function fileLineOf(error, block) {
  const first = error?.hash?.loc?.first_line;
  return Number.isInteger(first) && first > 0 ? block.firstCodeLine + first - 1 : block.openLine;
}

/**
 * Parse every mermaid block in `files`.
 *
 * Collects every failure rather than stopping at the first: a job that
 * surfaces one error per run turns a document with three bad diagrams into
 * three round trips through CI.
 *
 * @param {string[]} files repo-relative paths.
 * @param {(code: string) => Promise<void>} parse
 * @returns {Promise<{blocks: number, filesWithBlocks: number, failures: Failure[]}>}
 */
export async function checkFiles(files, parse) {
  /** @type {Failure[]} */
  const failures = [];
  let blocks = 0;
  let filesWithBlocks = 0;

  for (const file of files) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
    const found = extractMermaidBlocks(source);
    if (found.length === 0) continue;

    blocks += found.length;
    filesWithBlocks++;

    for (const block of found) {
      try {
        await parse(block.code);
      } catch (error) {
        failures.push({
          file,
          openLine: block.openLine,
          line: fileLineOf(error, block),
          message: String(error?.message ?? error).trim(),
        });
      }
    }
  }

  return { blocks, filesWithBlocks, failures };
}

/** Render one failure the way a compiler would, so editors can jump to it. */
export function formatFailure(failure) {
  const indented = failure.message
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return (
    `${failure.file}:${failure.line}: invalid mermaid diagram ` +
    `(block opens at ${failure.file}:${failure.openLine})\n${indented}`
  );
}

async function main(argv) {
  const files = argv.length > 0 ? argv : versionedMarkdownFiles();

  // Loading mermaid costs about a second; skip it when there is nothing to do.
  const anyMermaid = files.some((file) =>
    extractMermaidBlocks(fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8')).length > 0,
  );
  if (!anyMermaid) {
    console.log(`No mermaid diagrams in ${files.length} markdown file(s). Nothing to check.`);
    return 0;
  }

  const { blocks, filesWithBlocks, failures } = await checkFiles(files, await createParser());

  if (failures.length > 0) {
    for (const failure of failures) console.error(formatFailure(failure));
    console.error(
      `\n${failures.length} of ${blocks} mermaid diagram(s) failed to parse ` +
        `(mermaid ${await mermaidVersion()}).`,
    );
    return 1;
  }

  console.log(
    `${blocks} mermaid diagram(s) in ${filesWithBlocks} of ${files.length} markdown file(s) ` +
      `parse cleanly (mermaid ${await mermaidVersion()}).`,
  );
  return 0;
}

/** The pinned mermaid version, for the report — the check is only meaningful relative to it. */
async function mermaidVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'node_modules/mermaid/package.json'), 'utf-8'),
  );
  return pkg.version;
}

// Run as a CLI, but stay importable from the test suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
