import assert from 'node:assert/strict';

import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { GatedImage } from '../../lib/tiptap-image.js';
import { InlineMath, MathBlock } from '../../lib/tiptap-math.js';
import { MermaidBlock } from '../../lib/tiptap-mermaid.js';
import { RawInline, RawBlock } from '../../lib/tiptap-raw.js';
import MarkdownMdastPm from '../../lib/markdown-mdast-pm.js';
import MarkdownFrontmatter from '../../lib/markdown-frontmatter.js';

const { mdastToPm, pmToMdast } = MarkdownMdastPm;
export const { splitFrontmatter, joinFrontmatter } = MarkdownFrontmatter;

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const stringifier = unified().use(remarkStringify, {
  bullet: '-',
  fences: true,
  listItemIndent: 'one',
  rule: '-',
}).use(remarkGfm).use(remarkMath);

// Keep this extension list exactly aligned with lib/tiptap-entry.js. The
// configured callbacks affect only the image NodeView, not the headless schema.
export const schema = getSchema([
  StarterKit,
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  GatedImage.configure({
    inline: true,
    allowBase64: true,
    getNoteDir: null,
    resolveImagePath: null,
  }),
  InlineMath,
  MathBlock,
  MermaidBlock,
  RawInline,
  RawBlock,
]);

export function toBodyDoc(body) {
  const source = body == null ? '' : String(body);
  return mdastToPm(parser.parse(source), source);
}

export function toBodyMarkdown(doc) {
  return String(stringifier.stringify(pmToMdast(doc)));
}

export function engineRoundtrip(markdown) {
  const source = markdown == null ? '' : String(markdown);
  const { frontmatter, body } = splitFrontmatter(source);
  return joinFrontmatter(frontmatter, toBodyMarkdown(toBodyDoc(body)));
}

export function assertReopenSafe(markdown, label = 'document') {
  const source = markdown == null ? '' : String(markdown);
  const { body } = splitFrontmatter(source);
  const doc = toBodyDoc(body);
  assert.equal(doc.type, 'doc', `${label}: converter must emit a doc`);
  assert.ok(Array.isArray(doc.content) && doc.content.length > 0, `${label}: document must not be blank`);
  if (body.trim() === '') {
    assert.deepEqual(doc.content, [{ type: 'paragraph' }], `${label}: empty body contract`);
  }
  assert.doesNotThrow(
    () => schema.nodeFromJSON(doc).check(),
    `${label}: normalized content must reopen in the real Tiptap schema`,
  );
  return doc;
}
