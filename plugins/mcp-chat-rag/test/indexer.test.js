const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStore, EMBEDDING_DIM } = require('../lib/store');
const { indexAll } = require('../lib/indexer');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-rag-idx-'));
}

function makeStubEmbedder() {
  const seen = [];
  return {
    seen,
    isAvailable: true,
    async embedBatch(texts) {
      for (const t of texts) seen.push(t);
      return texts.map(() => new Float32Array(EMBEDDING_DIM).fill(0.1));
    }
  };
}

function writeJsonl(filePath, lines) {
  fs.writeFileSync(filePath, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

function mkSession(sessionId, cwd, turns) {
  return turns.map((t, i) => ({
    parentUuid: i === 0 ? null : `u-${sessionId}-${i - 1}`,
    type: t.role,
    message: { role: t.role, content: t.content },
    uuid: `u-${sessionId}-${i}`,
    timestamp: `2026-05-30T22:${20 + i}:00.000Z`,
    cwd,
    sessionId,
    version: '2.1.149',
    gitBranch: 'main'
  }));
}

test('T7.1 indexing a dir with two JSONL files creates two session rows and expected chunks', async () => {
  const root = tmpRoot();
  const proj = path.join(root, 'proj-1');
  fs.mkdirSync(proj, { recursive: true });
  writeJsonl(path.join(proj, 'a.jsonl'), mkSession('A', '/x/proj', [
    { role: 'user',      content: 'hello A' },
    { role: 'assistant', content: 'reply A' }
  ]));
  writeJsonl(path.join(proj, 'b.jsonl'), mkSession('B', '/x/proj', [
    { role: 'user',      content: 'hello B' }
  ]));

  const { file: dbFile } = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-rag-idx-db-'));
    return { file: path.join(dir, 'index.db') };
  })();
  const store = openStore(dbFile);
  const embedder = makeStubEmbedder();

  const stats = await indexAll({ store, embedder, root });
  assert.equal(stats.sessions_indexed, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c, 3);
  store.close();
});

test('T7.2 re-indexing same dir is a no-op (mtime gate)', async () => {
  const root = tmpRoot();
  const proj = path.join(root, 'proj-1');
  fs.mkdirSync(proj, { recursive: true });
  writeJsonl(path.join(proj, 'a.jsonl'), mkSession('A', '/x/proj', [
    { role: 'user', content: 'hello' }
  ]));

  const dbFile = path.join(tmpRoot(), 'index.db');
  const store = openStore(dbFile);

  const first = await indexAll({ store, embedder: makeStubEmbedder(), root });
  const second = await indexAll({ store, embedder: makeStubEmbedder(), root });

  assert.equal(first.sessions_indexed, 1);
  assert.equal(second.sessions_indexed, 0);
  assert.equal(second.sessions_skipped, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);
  store.close();
});

test('T7.3 malformed JSONL line is skipped; rest of file indexes', async () => {
  const root = tmpRoot();
  const proj = path.join(root, 'proj-1');
  fs.mkdirSync(proj, { recursive: true });
  const sess = mkSession('A', '/x/proj', [
    { role: 'user', content: 'before bad' }
  ]);
  const lines = [
    JSON.stringify(sess[0]),
    '{"type":"assistant","message":{"role":"assistant","content":"unterm', // bad
    JSON.stringify({ ...sess[0], uuid: 'u-A-2', timestamp: '2026-05-30T22:30:00.000Z', message: { role: 'user', content: 'after bad' } })
  ];
  writeJsonl(path.join(proj, 'a.jsonl'), lines);

  const dbFile = path.join(tmpRoot(), 'index.db');
  const store = openStore(dbFile);
  const stats = await indexAll({ store, embedder: makeStubEmbedder(), root });
  assert.equal(stats.sessions_indexed, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c, 2);
  store.close();
});

test('T7.4 symlinks under the dir are skipped', async () => {
  const root = tmpRoot();
  const proj = path.join(root, 'proj-1');
  fs.mkdirSync(proj, { recursive: true });
  writeJsonl(path.join(proj, 'a.jsonl'), mkSession('A', '/x/proj', [
    { role: 'user', content: 'hello' }
  ]));
  fs.symlinkSync(path.join(proj, 'a.jsonl'), path.join(proj, 'link.jsonl'));

  const dbFile = path.join(tmpRoot(), 'index.db');
  const store = openStore(dbFile);
  const stats = await indexAll({ store, embedder: makeStubEmbedder(), root });
  assert.equal(stats.sessions_indexed, 1, 'only the real file, not the symlink');
  store.close();
});

test('T7.5 session whose chunks are all dropped by redactor yields no session row', async () => {
  const root = tmpRoot();
  const proj = path.join(root, 'proj-1');
  fs.mkdirSync(proj, { recursive: true });
  const secret = 'sk-ant-' + 'X'.repeat(120); // 127 chars
  const tinyAround = 'k='; // very small wrapping; redactor should hit >50% threshold
  writeJsonl(path.join(proj, 'allbad.jsonl'), mkSession('A', '/x/proj', [
    { role: 'user', content: tinyAround + secret }
  ]));

  const dbFile = path.join(tmpRoot(), 'index.db');
  const store = openStore(dbFile);
  const stats = await indexAll({ store, embedder: makeStubEmbedder(), root });
  assert.equal(stats.sessions_indexed, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 0);
  store.close();
});

test('A2 the embedder never receives raw secret text (redactor runs before embedder)', async () => {
  const root = tmpRoot();
  const proj = path.join(root, 'proj-1');
  fs.mkdirSync(proj, { recursive: true });
  const turn = mkSession('A', '/x/proj', [
    { role: 'user',      content: 'before secret material below to keep chunk alive after redaction occurs in pipeline.' },
    { role: 'assistant', content: 'I will not echo sk-ant-' + 'B'.repeat(60) + ' to you.' }
  ]);
  writeJsonl(path.join(proj, 'a.jsonl'), turn);

  const dbFile = path.join(tmpRoot(), 'index.db');
  const store = openStore(dbFile);
  const embedder = makeStubEmbedder();
  await indexAll({ store, embedder, root });
  for (const text of embedder.seen) {
    assert.ok(!text.includes('sk-ant-B'), 'embedder received raw secret: ' + text.slice(0, 80));
  }
  store.close();
});
