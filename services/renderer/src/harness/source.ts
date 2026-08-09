/**
 * Where the gate's layouts come from: the committed seed, or the live index.
 *
 * Both sources produce the same `HarnessLayout[]`, so nothing downstream knows
 * or cares which one it is running against — the only difference between the
 * hermetic gate and the live gate is which of these two functions the CLI
 * called.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { HarnessInfraError, type HarnessLayout } from './types.js';

/** `<dir>/<slug>/layout.json`, the convention the seed and the validate CLI share. */
export function loadSeedLayouts(dir: string): HarnessLayout[] {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) {
    throw new HarnessInfraError(`No layout directory at ${root}.`);
  }

  const layouts: HarnessLayout[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, 'layout.json');
    if (!fs.existsSync(file)) continue;
    layouts.push({ slug: entry.name, layout: JSON.parse(fs.readFileSync(file, 'utf-8')) });
  }

  if (layouts.length === 0) {
    throw new HarnessInfraError(`No layouts found under ${root}.`);
  }
  return layouts;
}

/**
 * Every public layout from a running index, via the bulk export (#26).
 *
 * Everything that can go wrong here is an *infrastructure* failure, never a
 * verdict about the vendor — a self-hosted API being down says nothing about
 * whether a Pixel Agents bump breaks layouts, and reporting it as a breaking
 * change would be a lie that costs someone an afternoon.
 */
export async function fetchExportedLayouts(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HarnessLayout[]> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/export/layouts.ndjson`;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/x-ndjson' } });
  } catch (error) {
    throw new HarnessInfraError(`Could not reach the index at ${url}.`, error);
  }
  if (!response.ok) {
    throw new HarnessInfraError(`The index answered ${response.status} for ${url}.`);
  }

  const body = await response.text();
  const layouts: HarnessLayout[] = [];
  for (const line of body.split('\n')) {
    if (line.trim() === '') continue;
    let row: { slug?: unknown; layout?: unknown };
    try {
      row = JSON.parse(line) as typeof row;
    } catch (error) {
      throw new HarnessInfraError(`The export contained a line that is not JSON.`, error);
    }
    if (typeof row.slug !== 'string' || row.layout === undefined) {
      throw new HarnessInfraError('The export contained a row without a slug and a layout.');
    }
    layouts.push({ slug: row.slug, layout: row.layout });
  }

  // The export cannot signal a mid-stream failure with a status code — the 200
  // is long gone by then — so it publishes the line count up front instead.
  // Without this check a truncated download would look like a smaller index and
  // the gate would cheerfully pass on the half of it that arrived.
  const declared = response.headers.get('x-total-count');
  if (declared !== null && Number(declared) !== layouts.length) {
    throw new HarnessInfraError(
      `The export declared ${declared} layouts but ${layouts.length} arrived — the stream was truncated.`,
    );
  }

  return layouts;
}
