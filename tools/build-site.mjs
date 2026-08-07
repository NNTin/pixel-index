#!/usr/bin/env node
/**
 * Build the static gallery into dist/, ready for GitHub Pages.
 *
 * Expects tools/build-index.mjs and tools/render-previews.mjs to have run: the
 * site is a thin presentation layer over dist/index.json and dist/previews/.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DIST_DIR, readJsonOrNull } from './lib/layouts.mjs';

const index = readJsonOrNull(path.join(DIST_DIR, 'index.json'));
if (!index) {
  console.error('dist/index.json is missing. Run: npm run index');
  process.exit(1);
}

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const pin = index.pixelAgents;
const pinLabel = pin.commit
  ? `pixel-agents v${pin.version} (${pin.commit.slice(0, 7)})`
  : `pixel-agents v${pin.version}`;

function card(entry) {
  const missingPreview = !fs.existsSync(path.join(DIST_DIR, entry.files.preview));
  const facts = [
    `${entry.cols}×${entry.rows}`,
    `${entry.furniture} furniture`,
    entry.areas > 0 ? `${entry.areas} areas` : null,
    entry.pets > 0 ? `${entry.pets} pets` : null,
  ].filter(Boolean);

  return `      <article class="card">
        <a class="shot" href="${escape(entry.files.preview)}" title="Open full-size preview">
          ${
            missingPreview
              ? '<div class="missing">no preview</div>'
              : `<img src="${escape(entry.files.preview)}" alt="${escape(entry.title)} office layout" loading="lazy" />`
          }
        </a>
        <div class="body">
          <h2>${escape(entry.title)}</h2>
          <p class="by">by ${escape(entry.author)}${entry.license ? ` · ${escape(entry.license)}` : ''}</p>
          <p class="desc">${escape(entry.description)}</p>
          <p class="facts">${facts.map((fact) => `<span>${escape(fact)}</span>`).join('')}</p>
          ${
            entry.tags.length > 0
              ? `<p class="tags">${entry.tags.map((tag) => `<span>${escape(tag)}</span>`).join('')}</p>`
              : ''
          }
          <a class="download" href="${escape(entry.files.layout)}" download="${escape(entry.slug)}.json">Download layout.json</a>
        </div>
      </article>`;
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pixel Index — Pixel Agents office layouts</title>
    <meta name="description" content="A community index of office layouts for Pixel Agents." />
    <style>
      :root {
        color-scheme: dark;
        --bg: #12121c;
        --panel: #1e1e2e;
        --border: #3a3a52;
        --text: #e8e8f0;
        --muted: #a0a0b8;
        --accent: #7dd3fc;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 2rem 1.5rem 4rem;
        background: var(--bg);
        color: var(--text);
        font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      header { max-width: 1200px; margin: 0 auto 2.5rem; }
      h1 { margin: 0 0 .4rem; font-size: 1.9rem; letter-spacing: -.02em; }
      header p { margin: .2rem 0; color: var(--muted); }
      a { color: var(--accent); }
      .grid {
        max-width: 1200px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 1.5rem;
      }
      .card {
        background: var(--panel);
        border: 2px solid var(--border);
        display: flex;
        flex-direction: column;
      }
      .shot {
        display: block;
        /* Layouts are transparent outside the floor; a checker backdrop makes
           the office shape readable instead of blending into the card. */
        background:
          repeating-conic-gradient(#191926 0% 25%, #15151f 0% 50%) 50% / 16px 16px;
        padding: .75rem;
        line-height: 0;
      }
      .shot img {
        width: 100%;
        height: auto;
        image-rendering: pixelated;
      }
      .missing {
        padding: 3rem 0;
        text-align: center;
        color: var(--muted);
        font-size: .85rem;
        line-height: 1.4;
      }
      .body { padding: 1rem 1.1rem 1.2rem; display: flex; flex-direction: column; gap: .5rem; flex: 1; }
      h2 { margin: 0; font-size: 1.15rem; }
      .by { margin: 0; color: var(--muted); font-size: .85rem; }
      .desc { margin: 0; font-size: .92rem; }
      .facts, .tags { margin: 0; display: flex; flex-wrap: wrap; gap: .4rem; }
      .facts span, .tags span {
        font-size: .75rem;
        padding: .15rem .5rem;
        border: 1px solid var(--border);
        color: var(--muted);
      }
      .tags span { color: var(--accent); border-color: #2b4a5c; }
      .download {
        margin-top: auto;
        display: inline-block;
        text-align: center;
        padding: .55rem .8rem;
        border: 2px solid var(--accent);
        color: var(--accent);
        text-decoration: none;
        font-size: .9rem;
      }
      .download:hover { background: var(--accent); color: #10101a; }
      footer { max-width: 1200px; margin: 3rem auto 0; color: var(--muted); font-size: .85rem; }
      code { background: #00000040; padding: .1rem .35rem; }
    </style>
  </head>
  <body>
    <header>
      <h1>Pixel Index</h1>
      <p>Community office layouts for <a href="https://github.com/pixel-agents-hq/pixel-agents">Pixel Agents</a>.</p>
      <p>
        ${index.count} layout${index.count === 1 ? '' : 's'} · previews rendered with ${escape(pinLabel)} ·
        <a href="index.json">index.json</a>
      </p>
      <p>Download a layout, then load it in Pixel Agents with <strong>Layout → Import</strong>.</p>
    </header>
    <main class="grid">
${index.layouts.map(card).join('\n')}
    </main>
    <footer>
      <p>
        Generated ${escape(index.generatedAt)}. Previews are rendered by Pixel Agents' own
        renderer, so they match what you will see in the office.
      </p>
    </footer>
  </body>
</html>
`;

fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html);
// Pages would otherwise run the output through Jekyll and drop files it does
// not recognise.
fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '');

console.log(`Built site for ${index.count} layout(s) -> dist/index.html`);
