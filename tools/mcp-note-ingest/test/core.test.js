const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  sanitizeFileName,
  normalizeTags,
  normalizeTitle,
  normalizeBody,
  normalizeSource,
  buildFrontmatter,
  buildMarkdownDocument,
  buildTimestampPart,
  buildUniqueFileName
} = require('../lib/core');

test('sanitizeFileName removes forbidden characters and normalizes spaces', () => {
  const result = sanitizeFileName('  My: Test/File  Name?  ');
  assert.equal(result, 'my-testfile-name');
});

test('normalizeTags trims, deduplicates, and removes empty values', () => {
  const result = normalizeTags([' ai ', 'notes', '', 'ai', 'project']);
  assert.deepEqual(result, ['ai', 'notes', 'project']);
});

test('normalizeTags supports comma-separated string input', () => {
  const result = normalizeTags('chat, imported, chat,  test ');
  assert.deepEqual(result, ['chat', 'imported', 'test']);
});

test('normalizeTitle throws on missing title', () => {
  assert.throws(() => normalizeTitle('   '), /title is required/i);
});

test('normalizeBody returns fallback for empty body', () => {
  assert.equal(normalizeBody('   '), 'No body provided.');
});

test('normalizeSource lowercases the source', () => {
  assert.equal(normalizeSource('Claude'), 'claude');
});

test('buildFrontmatter writes source, model, created_at, and tags', () => {
  const output = buildFrontmatter({
    source: 'claude',
    createdAt: '2026-03-31T00:00:00.000Z',
    model: 'sonnet',
    tags: ['chat', 'imported']
  });

  assert.match(output, /source: "claude"/);
  assert.match(output, /created_at: "2026-03-31T00:00:00.000Z"/);
  assert.match(output, /model: "sonnet"/);
  assert.match(output, /tags: \["chat", "imported"\]/);
});

test('buildMarkdownDocument includes frontmatter, heading, and body', () => {
  const output = buildMarkdownDocument({
    title: 'Hello World',
    body: 'This is the body.',
    source: 'claude',
    createdAt: '2026-03-31T00:00:00.000Z',
    model: 'sonnet',
    tags: ['chat']
  });

  assert.match(output, /^---/);
  assert.match(output, /# Hello World/);
  assert.match(output, /This is the body\./);
});

test('buildTimestampPart creates expected UTC timestamp shape', () => {
  const date = new Date('2026-03-31T07:08:09.000Z');
  const result = buildTimestampPart(date);
  assert.equal(result, '20260331-070809');
});

test('buildUniqueFileName avoids collisions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-core-test-'));

  fs.writeFileSync(path.join(tempDir, '20260331-hello.md'), 'first', 'utf8');

  const result = buildUniqueFileName(tempDir, '20260331-hello');
  assert.equal(result, '20260331-hello-1.md');
});