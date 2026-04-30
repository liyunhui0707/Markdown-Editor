/* TDD: splitMarkdownIntoBlocks and findActiveBlock.
   Run: node --test test/live-editor-blocks.test.js */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { splitMarkdownIntoBlocks, findActiveBlock } = require('../lib/live-editor');

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertSliceInvariant(text, blocks) {
  for (const b of blocks) {
    assert.equal(text.slice(b.start, b.end), b.raw,
      `slice invariant failed: type=${b.type} start=${b.start} end=${b.end}`);
  }
}

// ── splitMarkdownIntoBlocks — API ─────────────────────────────────────────────

test('splitMarkdownIntoBlocks is a function', () => {
  assert.equal(typeof splitMarkdownIntoBlocks, 'function');
});

test('empty string returns []', () => {
  assert.deepEqual(splitMarkdownIntoBlocks(''), []);
});

test('null/undefined returns []', () => {
  assert.deepEqual(splitMarkdownIntoBlocks(null), []);
  assert.deepEqual(splitMarkdownIntoBlocks(undefined), []);
});

test('whitespace-only string returns []', () => {
  assert.deepEqual(splitMarkdownIntoBlocks('   \n\n   \n'), []);
});

// ── Block type classification ─────────────────────────────────────────────────

test('single heading produces one block with type heading', () => {
  const blocks = splitMarkdownIntoBlocks('# My Title');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].raw, '# My Title');
});

test('single paragraph produces one block with type paragraph', () => {
  const blocks = splitMarkdownIntoBlocks('Hello world.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[0].raw, 'Hello world.');
});

test('heading + blank + paragraph produces two blocks', () => {
  const text = '# Title\n\nHello world.';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'paragraph');
  assertSliceInvariant(text, blocks);
});

test('blank line is not a block', () => {
  const text = 'Para one.\n\nPara two.';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].raw, 'Para one.');
  assert.equal(blocks[1].raw, 'Para two.');
});

test('multiple blank lines between paragraphs still produces two blocks', () => {
  const text = 'Para one.\n\n\n\nPara two.';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].raw, 'Para one.');
  assert.equal(blocks[1].raw, 'Para two.');
  assertSliceInvariant(text, blocks);
});

test('hard-wrapped paragraph continuation lines merge into one block', () => {
  const text = 'Line one.\nLine two.\nLine three.';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[0].raw, text);
});

test('consecutive unordered list items merge into one list block', () => {
  const text = '- item one\n- item two\n- item three';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'list');
  assertSliceInvariant(text, blocks);
});

test('consecutive ordered list items merge into one list block', () => {
  const text = '1. first\n2. second\n3. third';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'list');
});

test('mixed unordered then ordered items without blank line merge into one list block', () => {
  // classifyLine returns 'list' for both '-' and '1.' styles, so they merge.
  // A blank line between them would produce two separate blocks.
  const text = '- unordered\n1. ordered';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'list');
  assertSliceInvariant(text, blocks);
});

test('multi-line blockquote merges into one blockquote block', () => {
  const text = '> First line.\n> Second line.';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'blockquote');
  assert.equal(blocks[0].raw, text);
});

test('indented list continuation line breaks the list into three blocks', () => {
  // classifyLine("  continued") returns 'paragraph' (not 'list'),
  // so the continuation line splits into: list / paragraph / list.
  const text = '- item one\n  continued\n- item two';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].type, 'list');
  assert.equal(blocks[0].raw, '- item one');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(blocks[1].raw, '  continued');
  assert.equal(blocks[2].type, 'list');
  assert.equal(blocks[2].raw, '- item two');
  assertSliceInvariant(text, blocks);
});

test('table line is classified as table and preserved', () => {
  const text = '| col1 | col2 |\n| a | b |';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.ok(blocks.length >= 1);
  assert.equal(blocks[0].type, 'table');
  assertSliceInvariant(text, blocks);
});

// ── Fenced code blocks ────────────────────────────────────────────────────────

test('fenced code block with backticks produces one code_fence block', () => {
  const text = '```js\nconsole.log("hi");\n```';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code_fence');
  assertSliceInvariant(text, blocks);
});

test('fenced code block with tildes produces one code_fence block', () => {
  const text = '~~~js\nconsole.log("hi");\n~~~';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code_fence');
});

test('fenced code block with internal blank lines produces one block', () => {
  const text = '```\nline one\n\nline two\n```';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code_fence');
  assert.ok(blocks[0].raw.includes('line one'));
  assert.ok(blocks[0].raw.includes('line two'));
  assertSliceInvariant(text, blocks);
});

test('unclosed fenced code block runs to EOF as one block', () => {
  const text = '```\nsome code\nno closing';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code_fence');
  assert.equal(blocks[0].end, text.length);
  assertSliceInvariant(text, blocks);
});

test('fenced code block with longer closing fence closes the block', () => {
  // /^(`{3,}|~{3,})/ matches ```` (4 backticks) as a valid closer — lock this.
  const text = '```\ncode\n````';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code_fence');
  assert.equal(blocks[0].raw, text);
  assertSliceInvariant(text, blocks);
});

// ── Trailing newline and EOF ───────────────────────────────────────────────────

test('document with trailing newline: heading block.end does not include the newline', () => {
  const text = '# Heading\n';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].raw, '# Heading');
  assert.equal(blocks[0].end, 9);
  assertSliceInvariant(text, blocks);
});

test('document without trailing newline: last block.end === text.length', () => {
  const text = 'Paragraph.';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].end, text.length);
  assertSliceInvariant(text, blocks);
});

// ── CRLF support ──────────────────────────────────────────────────────────────

test('CRLF document: same block structure as LF equivalent', () => {
  const lf   = '# Title\n\nParagraph.\n\n- item one\n- item two';
  const crlf = '# Title\r\n\r\nParagraph.\r\n\r\n- item one\r\n- item two';
  const lfBlocks   = splitMarkdownIntoBlocks(lf);
  const crlfBlocks = splitMarkdownIntoBlocks(crlf);
  assert.equal(crlfBlocks.length, lfBlocks.length);
  for (let i = 0; i < crlfBlocks.length; i++) {
    assert.equal(crlfBlocks[i].type, lfBlocks[i].type);
  }
});

test('CRLF document: slice invariant holds', () => {
  const text = '# Title\r\n\r\nParagraph.\r\n\r\n- item one\r\n- item two';
  assertSliceInvariant(text, splitMarkdownIntoBlocks(text));
});

// ── Slice invariant — general ─────────────────────────────────────────────────

test('slice invariant holds for a full multi-block document', () => {
  const text = '# Title\n\nParagraph text.\n\n- item one\n- item two\n\n> quote\n\n```js\ncode();\n```';
  assertSliceInvariant(text, splitMarkdownIntoBlocks(text));
});

test('blocks are ordered and non-overlapping', () => {
  const text = '# Title\n\nParagraph.\n\n- list item';
  const blocks = splitMarkdownIntoBlocks(text);
  for (let i = 1; i < blocks.length; i++) {
    assert.ok(blocks[i].start >= blocks[i - 1].end,
      `block ${i} overlaps block ${i - 1}`);
  }
});

test('every block has start, end, raw, and type fields', () => {
  const text = '# Title\n\nParagraph.';
  for (const b of splitMarkdownIntoBlocks(text)) {
    assert.ok('start' in b && 'end'  in b && 'raw' in b && 'type' in b);
  }
});

test('raw HTML in source passes through as paragraph raw text unchanged', () => {
  const text = 'Hello <div>world</div> there.';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].raw, text);
  assert.ok(blocks[0].raw.includes('<div>'));
});

// ── findActiveBlock ───────────────────────────────────────────────────────────

test('findActiveBlock is a function', () => {
  assert.equal(typeof findActiveBlock, 'function');
});

test('cursor inside heading returns that heading block', () => {
  const text   = '# My Title\n\nParagraph.';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, 5, text);
  assert.ok(active !== null);
  assert.equal(active.type, 'heading');
});

test('cursor inside paragraph returns that paragraph block', () => {
  const text   = '# Title\n\nHello world.';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, 14, text);
  assert.ok(active !== null);
  assert.equal(active.type, 'paragraph');
});

test('cursor inside list returns the list block', () => {
  const text   = '- item one\n- item two';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, 5, text);
  assert.ok(active !== null);
  assert.equal(active.type, 'list');
});

test('cursor inside fenced code returns that code_fence block', () => {
  const text   = '```\ncode here\n```';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, 6, text);
  assert.ok(active !== null);
  assert.equal(active.type, 'code_fence');
});

test('cursor at block.start returns that block', () => {
  const text   = '# Title\n\nParagraph.';
  const blocks = splitMarkdownIntoBlocks(text);
  const para   = blocks[1];
  const active = findActiveBlock(blocks, para.start, text);
  assert.equal(active, para);
});

test('cursor at block.end returns null', () => {
  const text   = '# Title\n\nParagraph.';
  const blocks = splitMarkdownIntoBlocks(text);
  const heading = blocks[0];
  const active  = findActiveBlock(blocks, heading.end, text);
  assert.equal(active, null);
});

test('cursor on blank separator line returns null', () => {
  const text   = '# Title\n\nParagraph.';
  // blank line occupies offset 8 (\n after heading)
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, 8, text);
  assert.equal(active, null);
});

test('cursor at EOF with trailing newline returns null', () => {
  const text   = '# Title\n';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, text.length, text);
  assert.equal(active, null);
});

test('cursor at EOF without trailing newline returns last block', () => {
  const text   = '# Title';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, text.length, text);
  assert.ok(active !== null);
  assert.equal(active.type, 'heading');
});

test('cursor at EOF without trailing newline on multi-block doc returns last block', () => {
  const text   = '# Title\n\nParagraph.';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, text.length, text);
  assert.ok(active !== null);
  assert.equal(active.type, 'paragraph');
});

test('empty document with offset 0 returns null', () => {
  const active = findActiveBlock([], 0, '');
  assert.equal(active, null);
});

test('whitespace-only document returns null for any cursor', () => {
  const text   = '   \n\n';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(findActiveBlock(blocks, 0, text), null);
  assert.equal(findActiveBlock(blocks, 2, text), null);
  assert.equal(findActiveBlock(blocks, text.length, text), null);
});

test('cursor less than zero returns null', () => {
  const text   = '# Title';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(findActiveBlock(blocks, -1, text), null);
});

test('cursor past text.length returns null', () => {
  const text   = '# Title';
  const blocks = splitMarkdownIntoBlocks(text);
  assert.equal(findActiveBlock(blocks, text.length + 1, text), null);
});

test('cursor at offset 0 returns the first block', () => {
  const text   = '# Title\n\nParagraph.';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, 0, text);
  assert.ok(active !== null);
  assert.equal(active.type, 'heading');
});

test('cursor at EOF with trailing whitespace gap returns null (bug regression)', () => {
  // "# T\n\n  ": lastChar is ' ' (not newline), but cursor is inside the gap,
  // not inside the heading block. Must return null, not the heading.
  const text   = '# T\n\n  ';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, text.length, text);
  assert.equal(active, null);
});

test('cursor at EOF with CRLF trailing whitespace gap returns null', () => {
  const text   = '# T\r\n\r\n  ';
  const blocks = splitMarkdownIntoBlocks(text);
  const active = findActiveBlock(blocks, text.length, text);
  assert.equal(active, null);
});
