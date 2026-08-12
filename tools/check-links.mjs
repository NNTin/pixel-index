#!/usr/bin/env node
/**
 * Check that every relative link in every versioned markdown file resolves
 * to a real file on disk.
 *
 *   node tools/check-links.mjs                  # all tracked markdown
 *   node tools/check-links.mjs docs/FOO.md ...  # just these files
 *
 * Exits non-zero if any relative link is broken, after reporting *all* of
 * them. Exits zero when there is nothing to check.
 *
 * ## Why only relative links
 *
 * markdown-link-check can also dial out and confirm http(s) links are still
 * alive. This deliberately does not: this repo's docs cross-reference each
 * other constantly (README -> CONTRIBUTING -> CONTENT_POLICY, the workspace
 * READMEs -> docs/ARCHITECTURE.md and back), and a relative link surviving a
 * doc move or rename is exactly the mistake worth catching cheaply, offline,
 * on every push. Confirming an external URL still resolves is a different,
 * noisier problem — rate limits, transient failures, hosts that block CI
 * runners — for a much smaller payoff, so external links are skipped via
 * `ignorePatterns` rather than attempted and retried.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import markdownLinkCheck from 'markdown-link-check';

import { versionedMarkdownFiles } from './check-mermaid.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Links this check does not resolve itself — left to whatever hits the network. */
const IGNORE_PATTERNS = [{ pattern: /^https?:\/\// }, { pattern: /^mailto:/ }];

/**
 * @typedef {object} Failure
 * @property {string} file Repo-relative path.
 * @property {string} link The broken link exactly as written.
 */

/**
 * Check every link in one file, relative ones for real and everything else
 * as `ignored` (see `IGNORE_PATTERNS`).
 *
 * @param {string} file repo-relative path.
 * @returns {Promise<{links: number, failures: Failure[]}>}
 */
function checkFile(file) {
  const absolute = path.join(REPO_ROOT, file);
  const markdown = fs.readFileSync(absolute, 'utf-8');
  // Relative links resolve against the file's own directory, same as the
  // markdown-link-check CLI does for a local file argument.
  const baseUrl = pathToFileURL(path.dirname(absolute) + path.sep).href;

  return new Promise((resolve, reject) => {
    markdownLinkCheck(markdown, { baseUrl, ignorePatterns: IGNORE_PATTERNS }, (err, results) => {
      if (err) {
        reject(err);
        return;
      }
      const failures = results
        .filter((result) => result.status === 'dead')
        .map((result) => ({ file, link: result.link }));
      resolve({ links: results.length, failures });
    });
  });
}

async function main(argv) {
  const files = argv.length > 0 ? argv : versionedMarkdownFiles();

  let links = 0;
  let filesWithLinks = 0;
  /** @type {Failure[]} */
  const failures = [];

  for (const file of files) {
    const result = await checkFile(file);
    if (result.links === 0) continue;
    links += result.links;
    filesWithLinks++;
    failures.push(...result.failures);
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`${failure.file}: broken link "${failure.link}"`);
    }
    console.error(
      `\n${failures.length} of ${links} link(s) in ${filesWithLinks} of ${files.length} ` +
        'markdown file(s) do not resolve.',
    );
    return 1;
  }

  console.log(
    `${links} link(s) in ${filesWithLinks} of ${files.length} markdown file(s) resolve ` +
      "(http(s)/mailto: links are not checked — see this file's header).",
  );
  return 0;
}

// Run as a CLI, but stay importable from a test suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
