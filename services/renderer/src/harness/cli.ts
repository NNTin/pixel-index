#!/usr/bin/env node
/**
 * The vendor-update gate's command line (#26).
 *
 *   harness run  --source seed --out baseline.json --png-dir out/baseline
 *   harness run  --source api --api-url https://api.example.com --out candidate.json
 *   harness diff --baseline baseline.json --candidate candidate.json --report report.md
 *
 * Split into two commands rather than one, because the two runs happen either
 * side of `git submodule update --remote`: the same process cannot hold both
 * pins, so each run persists its outcomes and `diff` compares the files.
 *
 * ## Exit codes
 *
 *   0  nothing that rendered before fails now
 *   1  regressions — the update broke something a human has to decide about
 *   2  infrastructure — a dev server, browser or API failed, and this run has
 *      NOTHING to say about the vendor
 *
 * 2 is the whole point of having three codes. A Vite that would not boot on a
 * cold runner is not evidence that upstream broke anything, and a workflow that
 * reports it as such teaches people to ignore the workflow.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { diffRuns } from './diff.js';
import { buildPreviewManifest } from './manifest.js';
import { renderPullRequestBody, renderReport, verdictHeadline } from './report.js';
import { runPin } from './run.js';
import { fetchExportedLayouts, loadSeedLayouts } from './source.js';
import { HarnessInfraError, type PinRun } from './types.js';

export const EXIT_OK = 0;
export const EXIT_REGRESSIONS = 1;
export const EXIT_INFRA = 2;

function arg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

/** Every occurrence, for flags that are legitimately repeated (`--section`). */
function args(argv: string[], name: string): string[] {
  const values: string[] = [];
  argv.forEach((token, index) => {
    if (token === `--${name}` && argv[index + 1] !== undefined) values.push(argv[index + 1]!);
  });
  return values;
}

function requireArg(argv: string[], name: string): string {
  const value = arg(argv, name);
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

function writeFile(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  // Trailing newline: the manifest is committed to the PR branch, and a file
  // without one shows up as "\ No newline at end of file" in every diff of it
  // forever.
  fs.writeFileSync(file, contents.endsWith('\n') ? contents : `${contents}\n`);
}

async function commandRun(argv: string[]): Promise<number> {
  const source = arg(argv, 'source') ?? 'seed';
  const out = requireArg(argv, 'out');

  const layouts =
    source === 'api'
      ? await fetchExportedLayouts(requireArg(argv, 'api-url'))
      : loadSeedLayouts(arg(argv, 'seed-dir') ?? 'seed');

  const label = source === 'api' ? `the live index (${layouts.length} layouts)` : 'seed/';
  console.log(`Rendering ${layouts.length} layout(s) from ${label}…`);

  const run = await runPin(layouts, {
    source: label,
    ...(arg(argv, 'upstream-dir') ? { upstreamDir: arg(argv, 'upstream-dir') } : {}),
    ...(arg(argv, 'png-dir') ? { pngDir: arg(argv, 'png-dir') } : {}),
    ...(arg(argv, 'concurrency') ? { concurrency: Number(arg(argv, 'concurrency')) } : {}),
    ...(arg(argv, 'timeout-ms') ? { timeoutMs: Number(arg(argv, 'timeout-ms')) } : {}),
    onProgress: (done, total) => {
      // One line per tenth, so a thousand-layout run leaves a readable log
      // rather than a thousand lines of noise.
      if (done === total || done % Math.max(1, Math.floor(total / 10)) === 0) {
        console.log(`  ${done}/${total}`);
      }
    },
  });

  writeFile(out, JSON.stringify(run, null, 2));

  const broken = Object.values(run.outcomes).filter((outcome) => outcome.status !== 'ok').length;
  console.log(
    `Done: ${Object.keys(run.outcomes).length - broken} rendered, ${broken} failed, ` +
      `against pixel-agents ${run.pin.version ?? '?'} (${run.pin.commit?.slice(0, 7) ?? 'unknown'}).`,
  );
  // `run` never decides anything on its own — a failure count is not a verdict
  // until it has been compared against the other pin.
  return EXIT_OK;
}

function readRun(file: string): PinRun {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as PinRun;
}

function commandDiff(argv: string[]): number {
  const baseline = readRun(requireArg(argv, 'baseline'));
  const candidate = readRun(requireArg(argv, 'candidate'));
  const gate = arg(argv, 'gate') ?? 'Gate';

  const verdict = diffRuns(baseline, candidate);
  const report = renderReport({ baseline, candidate, verdict, gate });

  console.log(report);
  if (arg(argv, 'report')) writeFile(arg(argv, 'report')!, report);
  if (arg(argv, 'json')) writeFile(arg(argv, 'json')!, JSON.stringify(verdict, null, 2));

  const previewBaseUrl = arg(argv, 'preview-base-url');
  if (arg(argv, 'manifest') && previewBaseUrl) {
    const manifest = buildPreviewManifest({
      baseline,
      candidate,
      verdict,
      baseUrl: previewBaseUrl,
      ...(arg(argv, 'upstream-url') ? { upstreamUrl: arg(argv, 'upstream-url') } : {}),
      ...(arg(argv, 'cap') ? { cap: Number(arg(argv, 'cap')) } : {}),
    });
    writeFile(arg(argv, 'manifest')!, JSON.stringify(manifest, null, 2));
    console.log(
      `Preview manifest: ${manifest.shown} layout(s) published ` +
        `(${manifest.changed} changed, ${manifest.failed} failed, cap ${manifest.cap}).`,
    );
  }

  // GitHub reads these; the workflow turns them into a label and a step summary.
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `tier=${verdict.tier}`,
        `regressions=${verdict.regressions.length}`,
        `visually-changed=${verdict.visuallyChanged.length}`,
        `headline=${verdictHeadline(verdict, gate)}`,
        '',
      ].join('\n'),
    );
  }

  return verdict.tier === 'pass' ? EXIT_OK : EXIT_REGRESSIONS;
}

/**
 * Compose the PR body from the per-gate reports.
 *
 * Here rather than in the workflow's shell because it is regenerated *whole*
 * on every run — upstream can move several times before anyone merges, and a
 * body assembled by appending heredocs is how a PR ends up carrying four stale
 * reports that nobody reads.
 */
function commandBody(argv: string[]): number {
  const sections = args(argv, 'section')
    .filter((file) => fs.existsSync(file))
    // trimEnd so a section that ends in its own blank line does not stack up
    // with the separator the body adds after it.
    .map((file) => fs.readFileSync(file, 'utf-8').trimEnd());

  const body = renderPullRequestBody({
    baselineCommit: requireArg(argv, 'baseline-commit'),
    candidateCommit: requireArg(argv, 'candidate-commit'),
    repoUrl: requireArg(argv, 'repo-url'),
    sections,
    ...(arg(argv, 'preview-url') ? { previewUrl: arg(argv, 'preview-url') } : {}),
  });

  writeFile(requireArg(argv, 'out'), body);
  return EXIT_OK;
}

export async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  try {
    if (command === 'run') return await commandRun(argv.slice(1));
    if (command === 'diff') return commandDiff(argv.slice(1));
    if (command === 'body') return commandBody(argv.slice(1));
    console.error('Usage: harness <run|diff|body> [options]');
    return EXIT_INFRA;
  } catch (error) {
    if (error instanceof HarnessInfraError) {
      // Loud, and explicitly NOT a verdict — the workflow keys on exit 2 to
      // report "could not tell" rather than "upstream is broken".
      console.error(`\nInfrastructure failure (not a vendor verdict): ${error.message}`);
      if (error.cause) console.error(error.cause);
      return EXIT_INFRA;
    }
    console.error(error);
    return EXIT_INFRA;
  }
}

// `endsWith` rather than an exact match: the workflow invokes this through tsx,
// which resolves the .ts path, while a built dist/ run resolves the .js one.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
