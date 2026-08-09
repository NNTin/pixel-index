import { describe, expect, it } from 'vitest';

import { extractMermaidBlocks } from './mermaid-blocks.mjs';

/** Terse view of a block, so the assertions read as "what and where". */
const summarise = (markdown) =>
  extractMermaidBlocks(markdown).map((block) => ({
    code: block.code,
    openLine: block.openLine,
    firstCodeLine: block.firstCodeLine,
  }));

describe('extractMermaidBlocks', () => {
  it('finds a plain ```mermaid block and reports where it starts', () => {
    const markdown = ['# Title', '', '```mermaid', 'flowchart TB', '  a --> b', '```', ''].join(
      '\n',
    );

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n  a --> b', openLine: 3, firstCodeLine: 4 },
    ]);
  });

  it('ignores fences in other languages, and documents with no fences at all', () => {
    expect(extractMermaidBlocks('```bash\nnpm ci\n```')).toEqual([]);
    expect(extractMermaidBlocks('```\nplain\n```')).toEqual([]);
    expect(extractMermaidBlocks('Just prose.\n')).toEqual([]);
  });

  it('does not match a language that merely starts with "mermaid"', () => {
    expect(extractMermaidBlocks('```mermaidjs\nflowchart TB\n```')).toEqual([]);
    expect(extractMermaidBlocks('```mermaid-example\nflowchart TB\n```')).toEqual([]);
  });

  it('matches the language case-insensitively, as GitHub does', () => {
    expect(summarise('```Mermaid\nflowchart TB\n```')).toEqual([
      { code: 'flowchart TB', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('reads only the first word of the info string, so trailing text is fine', () => {
    const markdown = '```mermaid title="Architecture" {highlight}\nflowchart TB\n  a --> b\n```';

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n  a --> b', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('accepts fences longer than three backticks', () => {
    const markdown = ['````mermaid', 'flowchart TB', '  a --> b', '````'].join('\n');

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n  a --> b', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('accepts tilde fences', () => {
    const markdown = ['~~~mermaid', 'flowchart TB', '  a --> b', '~~~'].join('\n');

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n  a --> b', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('closes on a longer fence but not a shorter one', () => {
    // The ``` in the middle is content: it is shorter than the ```` that opened
    // the block, so only the final ````` ends it.
    const markdown = ['````mermaid', 'flowchart TB', '```', '  a --> b', '`````'].join('\n');

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n```\n  a --> b', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('does not close a backtick fence with tildes, or the reverse', () => {
    expect(summarise('```mermaid\nflowchart TB\n~~~\n  a --> b\n```')).toEqual([
      { code: 'flowchart TB\n~~~\n  a --> b', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('requires a closing fence to stand alone on its line', () => {
    // "``` trailing" is not a close, so the block runs to the real one.
    const markdown = ['```mermaid', 'flowchart TB', '``` not a close', '  a --> b', '```'].join(
      '\n',
    );

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n``` not a close\n  a --> b', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('extracts a fence indented inside a list item, and strips that indent', () => {
    const markdown = [
      '1. First, look at the shape of it:',
      '',
      '   ```mermaid',
      '   flowchart TB',
      '     a --> b',
      '   ```',
      '',
      '2. Then read the code.',
    ].join('\n');

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n  a --> b', openLine: 3, firstCodeLine: 4 },
    ]);
  });

  it('strips no more than the fence indent, so deeper lines keep their shape', () => {
    const markdown = ['  ```mermaid', '  flowchart TB', '      a --> b', '  ```'].join('\n');

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n    a --> b', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('leaves a mermaid fence nested inside a longer fence alone — it is an example', () => {
    // The whole point: this document *documents* mermaid. The inner diagram is
    // deliberately broken and must never reach the parser.
    const markdown = [
      'Write a diagram like this:',
      '',
      '`````markdown',
      '```mermaid',
      'flowchart TB',
      '  a[[[[ -->',
      '```',
      '`````',
    ].join('\n');

    expect(extractMermaidBlocks(markdown)).toEqual([]);
  });

  it('leaves a mermaid fence nested inside a tilde fence alone', () => {
    const markdown = ['~~~markdown', '```mermaid', 'flowchart TB', '  a[[[[ -->', '```', '~~~'].join(
      '\n',
    );

    expect(extractMermaidBlocks(markdown)).toEqual([]);
  });

  it('still finds real diagrams that follow a nested example', () => {
    const markdown = [
      '`````markdown',
      '```mermaid',
      'broken [[[[',
      '```',
      '`````',
      '',
      '```mermaid',
      'flowchart TB',
      '  a --> b',
      '```',
    ].join('\n');

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB\n  a --> b', openLine: 7, firstCodeLine: 8 },
    ]);
  });

  it('is not fooled by a backtick inside the info string', () => {
    // CommonMark: a backtick in the info string means this was never a fence.
    expect(extractMermaidBlocks('```mermaid`\nflowchart TB\n```')).toEqual([]);
  });

  it('allows backticks in a tilde fence info string', () => {
    expect(summarise('~~~mermaid `x`\nflowchart TB\n~~~')).toEqual([
      { code: 'flowchart TB', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('treats an unclosed fence as running to the end of the document', () => {
    expect(summarise('```mermaid\nflowchart TB\n  a --> b\n')).toEqual([
      { code: 'flowchart TB\n  a --> b\n', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('reports a correct line number for every block in a long document', () => {
    const markdown = [
      'intro', // 1
      '```mermaid', // 2
      'flowchart TB', // 3
      '```', // 4
      '', // 5
      '```bash', // 6
      'npm ci', // 7
      '```', // 8
      '', // 9
      '~~~mermaid', // 10
      'sequenceDiagram', // 11
      '  A->>B: hi', // 12
      '~~~', // 13
    ].join('\n');

    expect(summarise(markdown)).toEqual([
      { code: 'flowchart TB', openLine: 2, firstCodeLine: 3 },
      { code: 'sequenceDiagram\n  A->>B: hi', openLine: 10, firstCodeLine: 11 },
    ]);
  });

  it('handles CRLF documents without dragging \\r into the diagram', () => {
    expect(summarise('```mermaid\r\nflowchart TB\r\n  a --> b\r\n```\r\n')).toEqual([
      { code: 'flowchart TB\n  a --> b', openLine: 1, firstCodeLine: 2 },
    ]);
  });

  it('keeps an empty mermaid block, rather than silently dropping it', () => {
    // An empty diagram is a *failing* diagram, not an absent one — mermaid
    // cannot detect a type. Dropping it here would hide that.
    expect(summarise('```mermaid\n```')).toEqual([{ code: '', openLine: 1, firstCodeLine: 2 }]);
  });
});
