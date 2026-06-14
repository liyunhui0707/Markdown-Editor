/* Remark bridge — Tiptap SCHEMA-VALIDITY integration test (headless).

   The blank/raw-fallback bug: when the converter emits a node the Tiptap
   schema doesn't have (e.g. an `image` node before the Image extension was
   added), strict `setContent({errorOnInvalidContent:true})` THROWS and the
   editor falls back to plain text — the whole note renders as raw Markdown.

   The pure-converter + remark-round-trip tests CAN'T catch this: they never
   touch the real Tiptap schema. This test builds the engine's actual schema
   with getSchema() (no DOM needed) and asserts the converter's output for
   every supported construct — and a full "kitchen sink" note — is
   schema-valid via schema.nodeFromJSON(), which throws on invalid content.

   This is exactly what setContent does internally, so "valid here" == "no
   plain-text fallback in the app". The extension list MUST stay in sync with
   lib/tiptap-entry.js. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Image } from '@tiptap/extension-image';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { InlineMath, MathBlock } from '../lib/tiptap-math.js';
import { MermaidBlock } from '../lib/tiptap-mermaid.js';
import MarkdownMdastPm from '../lib/markdown-mdast-pm.js';
const { mdastToPm } = MarkdownMdastPm;

// MUST match the extension set in lib/tiptap-entry.js.
const schema = getSchema([
  StarterKit,
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ inline: true, allowBase64: true }),
  InlineMath,
  MathBlock,
  MermaidBlock,
]);

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const toDoc = (md) => mdastToPm(parser.parse(md));

function assertValid(md, label) {
  const doc = toDoc(md);
  // nodeFromJSON checks node/mark EXISTENCE; node.check() additionally validates
  // content expressions AND mark-collection rules (e.g. the exclusive `code`
  // mark). setContent runs check(), so we must too — using only nodeFromJSON
  // previously missed a bold+code combo that blanked a whole note to raw text.
  assert.doesNotThrow(
    () => { schema.nodeFromJSON(doc).check(); },
    `${label}: converter output must pass node.check() (else setContent falls back to raw text)`,
  );
}

test('schema: each supported construct produces schema-valid PM JSON', () => {
  assertValid('# H1\n\n## H2\n\n### H3\n', 'headings');
  assertValid('**b** *i* `c` ~~s~~ [l](https://x)\n', 'inline marks');
  assertValid('**bold with `code` inside**\n', 'bold+code (exclusive code mark)');
  assertValid('a ***bold italic*** b and ~~**strike bold**~~\n', 'combined marks');
  assertValid('- a\n- b\n', 'bullet list');
  assertValid('1. a\n2. b\n', 'ordered list');
  assertValid('- [ ] a\n- [x] b\n', 'task list');
  assertValid('| A | B |\n| --- | --- |\n| 1 | 2 |\n', 'table');
  assertValid('```js\nconst x=1;\n```\n', 'fenced code');
  assertValid('> quote line 1\n> line 2\n', 'blockquote');
  assertValid('![alt](https://x/i.png)\n', 'inline image');     // the bug fix
  assertValid('text with a hard  \nbreak\n', 'hard break');
  assertValid('---\n', 'thematic break');
  assertValid('Inline $x^2$ math.\n', 'inline math');
  assertValid('$$\n\\sum_{i=1}^n i\n$$\n', 'display math');
  assertValid('```mermaid\ngraph TD; A-->B;\n```\n', 'mermaid block');
});

test('schema: the full "kitchen sink" note is schema-valid (the blank/raw-fallback fix)', () => {
  const md = [
    '---',
    'title: Kitchen Sink',
    'tags:',
    '  - qa',
    '  - wysiwyg',
    '---',
    '',
    '# Stage A + D — emphasis + headers',
    '',
    '**bold**, *italic*, `inline code`, ~~strike~~, [link](https://example.com).',
    '',
    '## H2',
    '### H3',
    '',
    '- bullet one',
    '- bullet two with `code` inside',
    '',
    '> Single-line blockquote.',
    '> Multi-line blockquote line 2.',
    '',
    '- [ ] task one',
    '- [x] task two',
    '',
    '---',
    '',
    '# Stage C — inline images',
    '',
    '![cat](https://placekitten.com/200/200)',
    '',
    '![bad](javascript:alert(1))',
    '',
    '![local](./assets/test.png)',
    '',
    '# Stage E — tables',
    '',
    '| Feature | Status |',
    '| --- | --- |',
    '| Tables | ok |',
    '| Tasks | ok |',
    '',
    '# Stage F — math (degrades to text/code)',
    '',
    'Inline $x^2$ and display:',
    '',
    '$$',
    '\\sum_{i=1}^n i',
    '$$',
    '',
    '# Stage G — mermaid (degrades to fenced code)',
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
    '',
    'Raw HTML: <div class="raw">hi</div>',
    '',
  ].join('\n');

  const doc = toDoc(md);
  assert.doesNotThrow(
    () => schema.nodeFromJSON(doc),
    'the complex note must be schema-valid so the WYSIWYG editor renders it (no plain-text fallback)',
  );
  assert.ok(doc.content.length > 5, 'doc has many blocks, not a degenerate fallback');
});
