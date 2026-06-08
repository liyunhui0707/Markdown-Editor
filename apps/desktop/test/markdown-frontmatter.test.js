'use strict';

/* Frontmatter split/join — pure tests. The bridge must preserve YAML
   frontmatter byte-for-byte (remark would corrupt it). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { splitFrontmatter, joinFrontmatter } = require('../lib/markdown-frontmatter.js');

test('splitFrontmatter: extracts leading YAML block, leaves body', () => {
  const md = '---\ntitle: Kitchen Sink\ntags:\n  - qa\n---\n\n# Body\n\ntext\n';
  const { frontmatter, body } = splitFrontmatter(md);
  assert.equal(frontmatter, '---\ntitle: Kitchen Sink\ntags:\n  - qa\n---');
  assert.equal(body, '# Body\n\ntext\n');
});

test('splitFrontmatter: no frontmatter -> empty frontmatter, body unchanged', () => {
  const md = '# Just a heading\n\nbody\n';
  const r = splitFrontmatter(md);
  assert.equal(r.frontmatter, '');
  assert.equal(r.body, md);
});

test('splitFrontmatter: a lone --- (horizontal rule, no closing fence) is NOT frontmatter', () => {
  const md = '---\n\nsome text after an HR\n';
  const r = splitFrontmatter(md);
  assert.equal(r.frontmatter, '', 'no closing fence -> not frontmatter');
  assert.equal(r.body, md);
});

test('splitFrontmatter: CRLF line endings', () => {
  const md = '---\r\ntitle: x\r\n---\r\n\r\nbody\r\n';
  const { frontmatter, body } = splitFrontmatter(md);
  assert.equal(frontmatter, '---\r\ntitle: x\r\n---');
  assert.equal(body, 'body\r\n');
});

test('splitFrontmatter: frontmatter with no trailing body', () => {
  const md = '---\ntitle: only\n---\n';
  const { frontmatter, body } = splitFrontmatter(md);
  assert.equal(frontmatter, '---\ntitle: only\n---');
  assert.equal(body, '');
});

test('joinFrontmatter: reattaches with a single blank line; YAML preserved exactly', () => {
  const fm = '---\ntitle: Kitchen Sink\ntags:\n  - qa\n---';
  const out = joinFrontmatter(fm, '# Body\n\ntext\n');
  assert.equal(out, '---\ntitle: Kitchen Sink\ntags:\n  - qa\n---\n\n# Body\n\ntext\n');
});

test('joinFrontmatter: empty frontmatter -> body unchanged', () => {
  assert.equal(joinFrontmatter('', '# B\n'), '# B\n');
  assert.equal(joinFrontmatter(null, 'x'), 'x');
});

test('joinFrontmatter: empty body -> frontmatter + newline', () => {
  assert.equal(joinFrontmatter('---\na: 1\n---', ''), '---\na: 1\n---\n');
});

test('round-trip via split/join preserves YAML structure exactly', () => {
  const md = '---\ntitle: Kitchen Sink\ntags:\n  - qa\n  - wysiwyg\n---\n\n# Body\n';
  const { frontmatter, body } = splitFrontmatter(md);
  // body would be remark-normalized in the real pipeline; here we just confirm
  // the frontmatter survives split->join untouched.
  const out = joinFrontmatter(frontmatter, body);
  assert.ok(out.startsWith('---\ntitle: Kitchen Sink\ntags:\n  - qa\n  - wysiwyg\n---'),
    'YAML indentation + list preserved (not reflowed)');
});
