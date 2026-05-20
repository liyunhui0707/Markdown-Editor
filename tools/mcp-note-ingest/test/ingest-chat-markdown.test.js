const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createIngestChatMarkdownHandler,
  schema,
  DEFAULT_TARGET_DIR
} = require('../lib/handlers/ingest-chat-markdown');

function mkTempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-')));
}

test('schema no longer requires vault_path', () => {
  assert.deepEqual(schema.inputSchema.required, ['title', 'body', 'source']);
  assert.ok(
    !('vault_path' in schema.inputSchema.properties),
    'vault_path must not appear in the schema anymore'
  );
});

test('DEFAULT_TARGET_DIR is the user-requested fixed path', () => {
  assert.equal(DEFAULT_TARGET_DIR, '/Users/liyunhui/Liyunhui/Inbox');
});

test('writes a Markdown file directly into targetDir (no YYYY/MM hierarchy)', () => {
  const targetDir = mkTempDir();
  const handler = createIngestChatMarkdownHandler({ targetDir });
  const res = handler({
    title: 'My note',
    body: 'hello world',
    source: 'claude',
    model: 'opus-4.7',
    tags: ['chat'],
    created_at: '2026-05-20T10:00:00Z'
  });
  assert.equal(res.structuredContent.ok, true);
  assert.equal(res.structuredContent.target_dir, targetDir);

  const fullPath = res.structuredContent.full_path;
  // File must live directly inside targetDir, not in any subfolder.
  assert.equal(path.dirname(fullPath), targetDir);
  assert.ok(fs.existsSync(fullPath), 'file should exist on disk');

  const contents = fs.readFileSync(fullPath, 'utf8');
  assert.ok(contents.includes('source: "claude"'), 'frontmatter should be present');
  assert.ok(contents.includes('# My note'), 'title heading should be present');
  assert.ok(contents.includes('hello world'), 'body should be written');
});

test('filename pattern is <timestamp>-<safe-title>.md', () => {
  const targetDir = mkTempDir();
  const handler = createIngestChatMarkdownHandler({ targetDir });
  const res = handler({
    title: 'Hello World',
    body: 'x',
    source: 'codex',
    created_at: '2026-05-20T10:00:00Z'
  });
  const fileName = res.structuredContent.file_name;
  assert.match(fileName, /^20260520-100000-hello-world\.md$/);
});

test('creates targetDir if it does not exist', () => {
  const parent = mkTempDir();
  const targetDir = path.join(parent, 'nested', 'inbox');
  const handler = createIngestChatMarkdownHandler({ targetDir });
  handler({ title: 't', body: 'b', source: 'claude' });
  assert.ok(fs.existsSync(targetDir), 'targetDir should be created on first call');
  const entries = fs.readdirSync(targetDir);
  assert.equal(entries.length, 1);
});

test('avoids same-timestamp collisions via buildUniqueFileName', () => {
  const targetDir = mkTempDir();
  const handler = createIngestChatMarkdownHandler({ targetDir });
  const a = handler({
    title: 'Note',
    body: 'a',
    source: 'claude',
    created_at: '2026-05-20T10:00:00Z'
  });
  const b = handler({
    title: 'Note',
    body: 'b',
    source: 'claude',
    created_at: '2026-05-20T10:00:00Z'
  });
  assert.notEqual(a.structuredContent.file_name, b.structuredContent.file_name);
  assert.ok(fs.existsSync(a.structuredContent.full_path));
  assert.ok(fs.existsSync(b.structuredContent.full_path));
});

test('does not require, and does not consume, a vault_path argument', () => {
  const targetDir = mkTempDir();
  const handler = createIngestChatMarkdownHandler({ targetDir });
  // Even if a client (incorrectly) passes vault_path, it must be ignored — the file
  // still lands in targetDir, never in the bogus vault path.
  const res = handler({
    title: 't',
    body: 'b',
    source: 'claude',
    vault_path: '/this/should/be/ignored'
  });
  assert.equal(path.dirname(res.structuredContent.full_path), targetDir);
});

test('MCP_INGEST_TARGET_DIR env var overrides the default', () => {
  const tmp = mkTempDir();
  const prior = process.env.MCP_INGEST_TARGET_DIR;
  process.env.MCP_INGEST_TARGET_DIR = tmp;
  try {
    const handler = createIngestChatMarkdownHandler();
    const res = handler({ title: 't', body: 'b', source: 'claude' });
    assert.equal(path.dirname(res.structuredContent.full_path), tmp);
  } finally {
    if (prior === undefined) delete process.env.MCP_INGEST_TARGET_DIR;
    else process.env.MCP_INGEST_TARGET_DIR = prior;
  }
});
