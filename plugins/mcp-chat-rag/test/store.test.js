const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStore } = require('../lib/store');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-rag-store-'));
  return { dir, file: path.join(dir, 'index.db') };
}

function sampleMeta(over = {}) {
  return {
    session_id: 'sess-abc',
    project: '/Users/x/proj',
    started_at: 1717200000,
    ended_at: 1717200300,
    turn_count: 3,
    source_path: '/Users/x/.claude/projects/foo/sess-abc.jsonl',
    source_mtime: 1717200300,
    ...over
  };
}

function sampleChunks(session_id = 'sess-abc') {
  return [
    { session_id, turn_index: 0, role: 'user',      ts: 1717200000, text: 'hello',   token_est: 2 },
    { session_id, turn_index: 1, role: 'assistant', ts: 1717200100, text: 'reply',   token_est: 2 },
    { session_id, turn_index: 2, role: 'assistant', ts: 1717200200, text: 'follow',  token_est: 2 }
  ];
}

test('T4.1 schema creates expected tables and meta rows', () => {
  const { file } = tmpDb();
  const store = openStore(file);
  const tables = store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table','virtual') OR type='table'"
  ).all().map(r => r.name);
  for (const t of ['sessions', 'chunks', 'chunks_fts', 'vec_chunks', 'meta']) {
    assert.ok(tables.includes(t), `expected table ${t}, got: ${tables.join(',')}`);
  }
  assert.equal(store.getMeta('schema_version'), '1');
  assert.equal(store.getMeta('embedding_model'), 'nomic-embed-text');
  assert.equal(store.getMeta('embedding_dim'), '768');
  store.close();
});

test('T4.2 insertSession populates chunks, chunks_fts, and (with embeddings) vec_chunks', () => {
  const { file } = tmpDb();
  const store = openStore(file);
  const chunks = sampleChunks();
  const embeddings = chunks.map(() => new Float32Array(768).fill(0.01));
  store.insertSession(sampleMeta(), chunks, embeddings);

  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c, 3);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks_fts').get().c, 3);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM vec_chunks').get().c, 3);
  store.close();
});

test('T4.2b insertSession with embeddings=null skips vec_chunks population', () => {
  const { file } = tmpDb();
  const store = openStore(file);
  store.insertSession(sampleMeta(), sampleChunks(), null);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c, 3);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM vec_chunks').get().c, 0);
  store.close();
});

test('T4.3 re-inserting the same session replaces prior rows', () => {
  const { file } = tmpDb();
  const store = openStore(file);
  store.insertSession(sampleMeta(), sampleChunks(), null);
  // Insert again with fewer chunks
  const fewerChunks = sampleChunks().slice(0, 1);
  store.insertSession(sampleMeta({ source_mtime: 1717200999, turn_count: 1 }), fewerChunks, null);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks_fts').get().c, 1);
  store.close();
});

test('T4.5 re-indexing the same source_path under a NEW session_id replaces the old row (no UNIQUE crash)', () => {
  const { file } = tmpDb();
  const store = openStore(file);
  const sharedPath = '/Users/x/.claude/projects/foo/file.jsonl';
  const embeddings = sampleChunks('OLD').map(() => new Float32Array(768).fill(0.02));
  store.insertSession(sampleMeta({ session_id: 'OLD', source_path: sharedPath }), sampleChunks('OLD'), embeddings);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);

  // Same file path, different session_id (e.g., the JSONL's recorded id changed).
  assert.doesNotThrow(() => {
    store.insertSession(
      sampleMeta({ session_id: 'NEW', source_path: sharedPath, source_mtime: 1717299999 }),
      sampleChunks('NEW'),
      sampleChunks('NEW').map(() => new Float32Array(768).fill(0.03))
    );
  });
  const sessions = store.db.prepare('SELECT session_id FROM sessions ORDER BY session_id').all().map(r => r.session_id);
  assert.deepEqual(sessions, ['NEW'], 'old session purged, only NEW remains');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c, 3, 'only NEW chunks');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM chunks_fts').get().c, 3, 'no orphan FTS rows');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM vec_chunks').get().c, 3, 'no orphan vec rows');
  store.close();
});

test('T4.4 getSessionByPath returns row when present, null otherwise', () => {
  const { file } = tmpDb();
  const store = openStore(file);
  const meta = sampleMeta();
  store.insertSession(meta, sampleChunks(), null);
  const got = store.getSessionByPath(meta.source_path);
  assert.ok(got, 'expected a row');
  assert.equal(got.source_mtime, meta.source_mtime);
  assert.equal(got.session_id, meta.session_id);

  const missing = store.getSessionByPath('/no/such/path.jsonl');
  assert.equal(missing, null);
  store.close();
});
