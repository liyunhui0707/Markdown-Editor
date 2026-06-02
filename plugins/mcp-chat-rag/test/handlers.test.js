const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStore, EMBEDDING_DIM } = require('../lib/store');
const { createRegistry } = require('../lib/handler-registry');
const { ToolError } = require('../lib/tool-error');

function tmpDbFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-rag-handlers-'));
  return path.join(dir, 'index.db');
}

function noopEmbedder() {
  return {
    isAvailable: true,
    async embedBatch(texts) {
      return texts.map(() => new Float32Array(EMBEDDING_DIM).fill(0.05));
    }
  };
}

function seed(store, sessionId, project, chunks, ts = 1717200000) {
  const embeddings = chunks.map(() => new Float32Array(EMBEDDING_DIM).fill(0.05));
  store.insertSession({
    session_id: sessionId,
    project,
    started_at: ts,
    ended_at: ts + chunks.length,
    turn_count: chunks.length,
    source_path: `/fake/${sessionId}.jsonl`,
    source_mtime: ts
  }, chunks.map((text, i) => ({
    session_id: sessionId, turn_index: i, role: i % 2 === 0 ? 'user' : 'assistant',
    ts: ts + i, text, token_est: Math.ceil(text.length / 4)
  })), embeddings);
}

function makeRegistry(store) {
  return createRegistry({
    store,
    embedder: noopEmbedder(),
    defaultProject: '/proj/A',
    isIndexing: () => false
  });
}

test('T8.1 search_chats returns documented shape with a valid citation', async () => {
  const store = openStore(tmpDbFile());
  seed(store, '8d53688c-ad6c-4055-a818-92b833dc669c', '/proj/A', ['CRLF normalization story']);
  const reg = makeRegistry(store);
  const out = await reg.handlers.search_chats({ query: 'CRLF', k: 3 });
  assert.ok(Array.isArray(out.results));
  assert.ok(out.results.length >= 1);
  const r = out.results[0];
  for (const k of ['chunk_id', 'session_id', 'project', 'ts', 'role', 'text', 'score', 'citation']) {
    assert.ok(k in r, `missing ${k}`);
  }
  assert.match(r.citation, /^[^/]+\/[0-9a-f-]{36}#\d+ \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
  store.close();
});

test('T8.2 search_chats with empty query throws ToolError (maps to -32602)', async () => {
  const store = openStore(tmpDbFile());
  const reg = makeRegistry(store);
  let caught;
  try { await reg.handlers.search_chats({ query: '' }); }
  catch (err) { caught = err; }
  assert.ok(caught instanceof ToolError, `expected ToolError, got ${caught && caught.name}`);
  store.close();
});

test('T8.3 get_session returns a window centered on the target chunk', async () => {
  const store = openStore(tmpDbFile());
  seed(store, 'sess-X', '/proj/A', ['t0', 't1', 't2', 't3', 't4', 't5', 't6']);
  const reg = makeRegistry(store);
  const all = store.db.prepare('SELECT chunk_id FROM chunks ORDER BY chunk_id').all();
  const centerId = all[3].chunk_id;
  const out = await reg.handlers.get_session({ session_id: 'sess-X', around_chunk_id: centerId, window: 2 });
  assert.equal(out.session_id, 'sess-X');
  assert.ok(out.turns.length <= 5);
  // Centered: turn at chunk centerId should be in the result
  assert.ok(out.turns.some(t => t.text === 't3'));
  store.close();
});

test('T8.4 get_session with unknown id throws ToolError (UNKNOWN_SESSION)', async () => {
  const store = openStore(tmpDbFile());
  const reg = makeRegistry(store);
  let caught;
  try { await reg.handlers.get_session({ session_id: 'does-not-exist' }); }
  catch (err) { caught = err; }
  assert.ok(caught instanceof ToolError);
  assert.equal(caught.code, 'UNKNOWN_SESSION');
  store.close();
});

test('T8.5 list_recent_sessions returns ≤ limit, sorted by started_at DESC, preview ≤ 200 chars', async () => {
  const store = openStore(tmpDbFile());
  seed(store, 'sess-1', '/proj/A', ['first sess intro'], 1000);
  seed(store, 'sess-2', '/proj/A', ['second sess intro'], 2000);
  seed(store, 'sess-3', '/proj/A', ['third sess intro'], 3000);
  const reg = makeRegistry(store);
  const out = await reg.handlers.list_recent_sessions({ limit: 2 });
  assert.equal(out.sessions.length, 2);
  assert.equal(out.sessions[0].session_id, 'sess-3');
  assert.equal(out.sessions[1].session_id, 'sess-2');
  for (const s of out.sessions) {
    assert.ok(s.first_user_turn_preview.length <= 200);
  }
  store.close();
});

test('listTools returns three tool schemas', () => {
  const store = openStore(tmpDbFile());
  const reg = makeRegistry(store);
  const tools = reg.listTools();
  const names = tools.map(t => t.name).sort();
  assert.deepEqual(names, ['get_session', 'list_recent_sessions', 'search_chats']);
  for (const t of tools) {
    assert.ok(t.inputSchema, `tool ${t.name} missing inputSchema`);
  }
  store.close();
});
