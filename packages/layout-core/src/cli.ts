#!/usr/bin/env node
/**
 * Validate every layout in a directory against the pinned Pixel Agents.
 *
 * A thin shell over the library: it owns the disk convention
 * (`<dir>/<slug>/{layout,meta}.json`) and the terminal formatting, and nothing
 * else. That convention is v1's and is on its way to `seed/` (#18), which is
 * exactly why it lives here rather than in the library.
 *
 *   pixel-index-validate [dir]        # defaults to ./layouts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { readJsonOrNull, upstreamPin } from './upstream.js';
import { createValidator } from './validate.js';
import type { ValidationIssue } from './types.js';

const dir = path.resolve(process.argv[2] ?? 'layouts');

if (!fs.existsSync(dir)) {
  console.error(`No layout directory at ${dir}.`);
  process.exit(1);
}

const slugs = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (slugs.length === 0) {
  console.error(`No layouts found under ${dir}.`);
  process.exit(1);
}

const pin = upstreamPin();
const validator = createValidator({ upstreamVersion: pin.version });

/** slug -> issues, so the report can group by layout the way a reader thinks. */
const failures = new Map<string, ValidationIssue[]>();

for (const slug of slugs) {
  const issues: ValidationIssue[] = [];
  const layoutPath = path.join(dir, slug, 'layout.json');
  const metaPath = path.join(dir, slug, 'meta.json');

  issues.push(...validator.validateSlug(slug).issues);

  if (!fs.existsSync(metaPath)) {
    issues.push({ code: 'meta.invalid_json', path: '/', message: 'missing meta.json' });
  } else {
    const meta = readJsonOrNull(metaPath);
    issues.push(
      ...(meta === null
        ? [
            {
              code: 'meta.invalid_json' as const,
              path: '/',
              message: 'meta.json is not valid JSON',
            },
          ]
        : validator.validateMeta(meta).issues),
    );
  }

  if (!fs.existsSync(layoutPath)) {
    issues.push({ code: 'layout.invalid_json', path: '/', message: 'missing layout.json' });
  } else {
    const layout = readJsonOrNull(layoutPath);
    issues.push(
      ...(layout === null
        ? [
            {
              code: 'layout.invalid_json' as const,
              path: '/',
              message: 'layout.json is not valid JSON',
            },
          ]
        : validator.validateLayout(layout).issues),
    );
  }

  if (issues.length > 0) failures.set(slug, issues);
}

console.log(
  `Validated ${slugs.length} layout(s) against pixel-agents ${pin.version}` +
    `${pin.commit ? ` (${pin.commit.slice(0, 7)})` : ''}, ` +
    `bundled layoutRevision ${validator.requiredRevision}.`,
);

let total = 0;
for (const [slug, issues] of failures) {
  for (const issue of issues) {
    total += 1;
    console.error(`  error: ${slug}${issue.path === '/' ? '' : issue.path}: ${issue.message}`);
  }
}

if (total > 0) {
  console.error(`\n${total} error(s).`);
  process.exit(1);
}
console.log('\nOK.');
