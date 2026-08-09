/**
 * Pull the mermaid diagrams out of a markdown document.
 *
 * Split out from `tools/check-mermaid.mjs` because this half is the part that
 * can be subtly wrong in ways a passing CI job would never reveal: the checker
 * only ever sees the blocks this file hands it, so a block missed here is a
 * diagram nobody is validating, and a block invented here is an *example* of
 * mermaid getting reported as a broken diagram.
 *
 * The rules implemented are CommonMark's fenced-code-block rules, kept to the
 * parts that matter for finding diagrams:
 *
 *   - A fence is three or more backticks or three or more tildes. More than
 *     three is legal and common — it is how you nest a fence inside a fence.
 *   - A closing fence must use the *same character* and be *at least as long*
 *     as the one that opened the block, with nothing but whitespace after it.
 *     This one rule is what makes nesting work: a ``` inside a ````-block is
 *     content, and a ``` inside a ~~~-block is content. Both are examples of
 *     mermaid rather than diagrams, and neither must be validated.
 *   - The language is the first word of the info string, so ```mermaid and
 *     ```mermaid title="x" are both diagrams. Matching is case-insensitive,
 *     which is what GitHub does.
 *   - For a backtick fence the info string may not contain a backtick — that
 *     is inline code on a line of its own, not a fence.
 *   - A fence may be indented (inside a list item, say). That indent is
 *     stripped from the content, otherwise every diagram in a numbered list
 *     would reach the parser with leading whitespace mermaid does not expect.
 *
 * Deliberately *not* implemented: block-container tracking, so a fence
 * indented four spaces at the top level reads as a fence rather than as an
 * indented code block. Telling those apart needs a full CommonMark container
 * parser, and the payoff is a case nobody writes — people nest examples with
 * longer fences, which is handled exactly.
 */

/** `[ \t]*` then 3+ of one fence character, then the info string. */
const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

/**
 * @typedef {object} MermaidBlock
 * @property {string} code            The diagram source, with the fence indent stripped.
 * @property {number} openLine        1-based line of the opening fence.
 * @property {number} firstCodeLine   1-based line of the first line of `code`.
 * @property {string} infoString      The info string, trimmed. Usually just "mermaid".
 */

/**
 * @param {string} markdown
 * @returns {MermaidBlock[]} in document order.
 */
export function extractMermaidBlocks(markdown) {
  const lines = markdown.split(/\r\n|\n|\r/);
  /** @type {MermaidBlock[]} */
  const blocks = [];
  /** @type {{char: string, length: number, indent: string, infoString: string, openLine: number, content: string[]} | null} */
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (open) {
      if (closes(line, open)) {
        flush(blocks, open);
        open = null;
      } else {
        open.content.push(stripIndent(line, open.indent));
      }
      continue;
    }

    const match = FENCE.exec(line);
    if (!match) continue;

    const [, indent, fence, info] = match;
    // An info string with a backtick in it means this was never a fence.
    if (fence[0] === '`' && info.includes('`')) continue;

    open = {
      char: fence[0],
      length: fence.length,
      indent,
      infoString: info.trim(),
      openLine: i + 1,
      content: [],
    };
  }

  // An unclosed fence runs to the end of the document, and GitHub renders it.
  if (open) flush(blocks, open);

  return blocks;
}

/** Does `line` close `open`? Same character, no shorter, nothing but whitespace after. */
function closes(line, open) {
  const match = FENCE.exec(line);
  if (!match) return false;
  const [, , fence, rest] = match;
  return fence[0] === open.char && fence.length >= open.length && rest.trim() === '';
}

/**
 * Remove the opening fence's indent from a content line — at most that much,
 * and only whitespace, so a deeper-indented line keeps its relative shape.
 */
function stripIndent(line, indent) {
  let i = 0;
  while (i < indent.length && i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return line.slice(i);
}

function flush(blocks, open) {
  if (languageOf(open.infoString) !== 'mermaid') return;
  blocks.push({
    code: open.content.join('\n'),
    openLine: open.openLine,
    firstCodeLine: open.openLine + 1,
    infoString: open.infoString,
  });
}

/** The first word of an info string, lowercased — what GitHub keys the renderer off. */
function languageOf(infoString) {
  return infoString.split(/\s+/, 1)[0].toLowerCase();
}
