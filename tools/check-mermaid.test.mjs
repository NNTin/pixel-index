import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkFiles,
  createParser,
  formatFailure,
  versionedMarkdownFiles,
} from './check-mermaid.mjs';

/**
 * Fixtures are written into the repo working tree (untracked, and cleaned up),
 * because `checkFiles` resolves paths against the repo root — the same way the
 * CLI feeds it `git ls-files` output.
 */
const FIXTURE_DIR = path.resolve(import.meta.dirname, '../.mermaid-fixtures');
const rel = (name) => path.posix.join('.mermaid-fixtures', name);

function write(name, contents) {
  fs.writeFileSync(path.join(FIXTURE_DIR, name), contents);
  return rel(name);
}

let parse;

beforeAll(async () => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  parse = await createParser();
}, 30_000);

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe('createParser', () => {
  it('accepts valid diagrams across the diagram types this repo uses', async () => {
    await expect(parse('flowchart TB\n  a["A"] --> b["B"]')).resolves.toBeUndefined();
    await expect(parse('sequenceDiagram\n  Alice->>Bob: hi')).resolves.toBeUndefined();
    await expect(
      parse('flowchart TB\n  subgraph g["G"]\n    a --> b\n  end'),
    ).resolves.toBeUndefined();
  });

  it('rejects a syntax error, and says where', async () => {
    await expect(parse('flowchart TB\n  a[[[[ -->')).rejects.toThrow(/Parse error/);
  });

  it('rejects text that is not a diagram at all', async () => {
    await expect(parse('this is prose, not a diagram')).rejects.toThrow(/No diagram type detected/);
    await expect(parse('')).rejects.toThrow(/No diagram type detected/);
  });
});

describe('checkFiles', () => {
  it('reports nothing for markdown with no mermaid in it', async () => {
    const file = write('none.md', '# Title\n\n```bash\nnpm ci\n```\n');

    expect(await checkFiles([file], parse)).toEqual({
      blocks: 0,
      filesWithBlocks: 0,
      failures: [],
    });
  });

  it('counts the diagrams it checked when they all pass', async () => {
    const file = write(
      'good.md',
      ['```mermaid', 'flowchart TB', '  a --> b', '```', '', '```mermaid', 'pie', '  "a" : 1', '```'].join(
        '\n',
      ),
    );

    expect(await checkFiles([file], parse)).toEqual({
      blocks: 2,
      filesWithBlocks: 1,
      failures: [],
    });
  });

  it('maps the parser\'s line onto the line in the file', async () => {
    const file = write(
      'offset.md',
      [
        '# Title', // 1
        '', // 2
        'Some prose.', // 3
        '', // 4
        '```mermaid', // 5
        'flowchart TB', // 6
        '  a --> b', // 7
        '  c[[[[ -->', // 8  <- the bad line
        '```', // 9
      ].join('\n'),
    );

    const { failures } = await checkFiles([file], parse);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ file, openLine: 5, line: 8 });
    expect(failures[0].message).toMatch(/Parse error/);
  });

  it('falls back to the opening fence when the error carries no position', async () => {
    const file = write('unknown.md', ['prose', '```mermaid', 'not a diagram', '```'].join('\n'));

    const { failures } = await checkFiles([file], parse);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ file, openLine: 2, line: 2 });
    expect(failures[0].message).toMatch(/No diagram type detected/);
  });

  it('reports every failure, across every file, not just the first', async () => {
    const a = write(
      'bad-a.md',
      [
        '```mermaid', // 1
        'flowchart TB', // 2
        '  a[[[[ -->', // 3
        '```', // 4
        '', // 5
        '```mermaid', // 6
        'flowchart TB', // 7
        '  ok --> fine', // 8
        '```', // 9
        '', // 10
        '```mermaid', // 11
        'still not a diagram', // 12
        '```', // 13
      ].join('\n'),
    );
    const b = write('bad-b.md', ['```mermaid', 'sequenceDiagram', '  loop', '```'].join('\n'));

    const { blocks, filesWithBlocks, failures } = await checkFiles([a, b], parse);

    expect({ blocks, filesWithBlocks }).toEqual({ blocks: 4, filesWithBlocks: 2 });
    expect(failures.map((f) => ({ file: f.file, line: f.line }))).toEqual([
      { file: a, line: 3 },
      { file: a, line: 11 }, // no position on the error, so: the fence line
      { file: b, line: 4 },
    ]);
  });

  it('never validates a mermaid block that is an example inside a bigger fence', async () => {
    const file = write(
      'example.md',
      [
        'To draw one, write:',
        '',
        '`````markdown',
        '```mermaid',
        'deliberately [[[[ broken',
        '```',
        '`````',
      ].join('\n'),
    );

    expect(await checkFiles([file], parse)).toEqual({
      blocks: 0,
      filesWithBlocks: 0,
      failures: [],
    });
  });
});

describe('formatFailure', () => {
  it('leads with path:line so an editor can jump to it', () => {
    const text = formatFailure({
      file: 'docs/ARCHITECTURE.md',
      openLine: 26,
      line: 29,
      message: 'Parse error on line 4:\n...whatever mermaid said',
    });

    expect(text.split('\n')[0]).toBe(
      'docs/ARCHITECTURE.md:29: invalid mermaid diagram (block opens at docs/ARCHITECTURE.md:26)',
    );
    expect(text).toContain('    Parse error on line 4:');
    expect(text).toContain('    ...whatever mermaid said');
  });
});

describe('versionedMarkdownFiles', () => {
  const files = versionedMarkdownFiles();

  it('finds markdown recursively, not just at the root', () => {
    expect(files).toContain('README.md');
    expect(files).toContain('docs/ARCHITECTURE.md');
    expect(files).toContain('apps/web/README.md');
  });

  it('stops at the submodule and at untracked files', () => {
    // vendor/pixel-agents is a gitlink: its markdown is upstream's problem.
    expect(files.some((f) => f.startsWith('vendor/'))).toBe(false);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);

    const untracked = write('untracked.md', '```mermaid\nbroken [[[[\n```');
    expect(versionedMarkdownFiles()).not.toContain(untracked);
  });
});

describe('the diagrams this repo actually ships', () => {
  it('all parse', async () => {
    const { failures } = await checkFiles(versionedMarkdownFiles(), parse);

    expect(failures.map(formatFailure)).toEqual([]);
  }, 30_000);
});
