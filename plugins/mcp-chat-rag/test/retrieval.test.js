const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStore, EMBEDDING_DIM } = require('../lib/store');
const { search, rrfCombine } = require('../lib/retrieval');

function tmpDbFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-rag-ret-'));
  return path.join(dir, 'index.db');
}

function seedStore(store, sessionId, project, chunks, ts = 1717200000) {
  const embeddings = chunks.map(() => new Float32Array(EMBEDDING_DIM).fill(0.05));
  store.insertSession({
    session_id: sessionId,
    project,
    started_at: ts,
    ended_at: ts + 100,
    turn_count: chunks.length,
    source_path: `/fake/${sessionId}.jsonl`,
    source_mtime: ts
  }, chunks.map((text, i) => ({
    session_id: sessionId,
    turn_index: i,
    role: i % 2 === 0 ? 'user' : 'assistant',
    ts: ts + i,
    text,
    token_est: Math.ceil(text.length / 4)
  })), embeddings);
}

function noopEmbedder() {
  return {
    isAvailable: true,
    async embedBatch(texts) {
      return texts.map(() => new Float32Array(EMBEDDING_DIM).fill(0.05));
    }
  };
}

function throwingEmbedder() {
  return {
    isAvailable: true,
    async embedBatch() { throw new Error('ollama down'); }
  };
}

test('T5.1 BM25 ranks an exact-word match high', async () => {
  const store = openStore(tmpDbFile());
  seedStore(store, 'S1', '/proj/A', [
    'turn 0 alpha',
    'turn 1 about CRLF normalization edge cases',
    'turn 2 unrelated text about apples'
  ]);
  const r = await search({ store, embedder: noopEmbedder(), query: 'CRLF normalization', k: 5 });
  assert.ok(r.results.length >= 1);
  assert.match(r.results[0].text, /CRLF/);
  store.close();
});

test('T5.2 rrfCombine ranks an item at the top of both lists first', () => {
  const listA = [{ id: 'b' }, { id: 'a' }, { id: 'c' }]; // ranks: b=0, a=1, c=2
  const listB = [{ id: 'b' }, { id: 'c' }, { id: 'a' }]; // ranks: b=0, c=1, a=2
  const merged = rrfCombine([listA, listB], r => r.id);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, 'b', 'item at rank 0 in both lists must win');
});

test('T5.2b rrfCombine handles items present in only one list', () => {
  const listA = [{ id: 'x' }, { id: 'y' }];
  const listB = [{ id: 'y' }, { id: 'z' }];
  const merged = rrfCombine([listA, listB], r => r.id);
  assert.equal(merged.length, 3, 'union of both lists');
  // y is in both at moderate ranks: 1/61 + 1/60 = 0.03306
  // x is only in A at rank 0:      1/60          = 0.01667
  // z is only in B at rank 1:      1/61          = 0.01639
  assert.equal(merged[0].id, 'y');
});

test('T5.3 project filter restricts results to the given project', async () => {
  const store = openStore(tmpDbFile());
  seedStore(store, 'S1', '/proj/A', ['alpha text']);
  seedStore(store, 'S2', '/proj/B', ['alpha text']);
  const r = await search({ store, embedder: noopEmbedder(), query: 'alpha', project: '/proj/A', k: 10 });
  for (const x of r.results) assert.equal(x.project, '/proj/A');
  store.close();
});

test('T5.4 date range filter is applied inclusively', async () => {
  const store = openStore(tmpDbFile());
  seedStore(store, 'S1', '/proj/A', ['alpha old'],    1000);
  seedStore(store, 'S2', '/proj/A', ['alpha middle'], 2000);
  seedStore(store, 'S3', '/proj/A', ['alpha new'],    3000);
  const r = await search({
    store, embedder: noopEmbedder(),
    query: 'alpha',
    project: '/proj/A',
    dateFrom: 1500, dateTo: 2500,
    k: 10
  });
  for (const x of r.results) {
    const tsUnix = Math.floor(new Date(x.ts).getTime() / 1000);
    assert.ok(tsUnix >= 1500 && tsUnix <= 2500, `ts ${x.ts} (${tsUnix}) outside window`);
  }
  store.close();
});

test('T5.5 embedder failure falls back to BM25 with ollama_unavailable warning', async () => {
  const store = openStore(tmpDbFile());
  seedStore(store, 'S1', '/proj/A', ['alpha CRLF']);
  const r = await search({ store, embedder: throwingEmbedder(), query: 'CRLF', k: 5 });
  assert.ok(r.warnings.includes('ollama_unavailable_bm25_only'));
  assert.ok(r.results.length >= 1);
  store.close();
});

function vecOf(values) {
  const a = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < values.length; i++) a[i] = values[i];
  return a;
}

function seedStoreEmb(store, sessionId, project, items, ts = 1717200000) {
  store.insertSession({
    session_id: sessionId,
    project,
    started_at: ts,
    ended_at: ts + items.length,
    turn_count: items.length,
    source_path: `/fake/${sessionId}.jsonl`,
    source_mtime: ts
  }, items.map((it, i) => ({
    session_id: sessionId,
    turn_index: i,
    role: i % 2 === 0 ? 'user' : 'assistant',
    ts: ts + i,
    text: it.text,
    token_est: Math.ceil(it.text.length / 4)
  })), items.map(it => it.embedding));
}

test('T5.7 project-scoped vector search returns in-scope hits even when global-nearest are out of scope', async () => {
  const store = openStore(tmpDbFile());
  // Out-of-scope project A: > POOL_SIZE chunks whose vectors are nearest to the query.
  const near = vecOf([1, 0, 0]);
  const far  = vecOf([0, 1, 0]);
  const aItems = [];
  for (let i = 0; i < 60; i++) aItems.push({ text: `noise alpha ${i}`, embedding: near });
  seedStoreEmb(store, 'A', '/proj/A', aItems);
  // In-scope project B: one chunk whose vector is FAR from the query and whose
  // text does NOT contain the query term, so BM25 cannot rescue it.
  seedStoreEmb(store, 'B', '/proj/B', [{ text: 'zzzq unrelated wording', embedding: far }]);

  // Embedder returns the query vector = `near`, so global-nearest are all project A.
  const embedder = {
    isAvailable: true,
    async embedBatch() { return [vecOf([1, 0, 0])]; }
  };

  const r = await search({ store, embedder, query: 'alpha', project: '/proj/B', k: 8 });
  assert.ok(r.results.length >= 1, 'scoped vector search must return the in-scope chunk');
  for (const x of r.results) assert.equal(x.project, '/proj/B');
  assert.ok(r.results.some(x => x.session_id === 'B'));
  store.close();
});

test('T5.6 empty DB returns empty results with index_empty warning', async () => {
  const store = openStore(tmpDbFile());
  const r = await search({ store, embedder: noopEmbedder(), query: 'anything', k: 5 });
  assert.equal(r.results.length, 0);
  assert.ok(r.warnings.includes('index_empty'));
  store.close();
});
