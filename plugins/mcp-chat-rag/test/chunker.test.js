const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunkTurn } = require('../lib/chunker');

const baseTurn = {
  session_id: 'sess-1',
  turn_index: 0,
  role: 'assistant',
  kind: 'assistant_text',
  ts: '2026-05-30T22:20:00.000Z'
};

test('T2.1 turn with text under hardMax produces exactly one chunk', () => {
  const text = 'short reply';
  const chunks = chunkTurn({ ...baseTurn, text });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, text);
  assert.equal(chunks[0].token_est, Math.ceil(text.length / 4));
  assert.equal(chunks[0].session_id, 'sess-1');
  assert.equal(chunks[0].turn_index, 0);
  assert.equal(chunks[0].role, 'assistant');
});

test('T2.4 empty text yields zero chunks', () => {
  const chunks = chunkTurn({ ...baseTurn, text: '' });
  assert.equal(chunks.length, 0);
});

test('T2.2 turn exceeding hardMax is sub-split and every chunk fits the budget', () => {
  // 6000 chars = 1500 token_est, exceeds hardMax=1000
  const text = 'lorem ipsum dolor sit amet '.repeat(250);
  const chunks = chunkTurn({ ...baseTurn, text });
  assert.ok(chunks.length >= 2, `expected at least 2 chunks, got ${chunks.length}`);
  for (const c of chunks) {
    assert.ok(c.token_est <= 1000, `chunk token_est=${c.token_est} > 1000`);
  }
  // Loss-free reassembly check (chunks may be joined with separator)
  const joined = chunks.map(c => c.text).join('');
  assert.equal(joined, text, 'chunks must reassemble losslessly');
});

test('T2.3 sub-split prefers \\n## heading boundaries', () => {
  // Build a long text with clear `\n## ` boundaries
  const section1 = 'a'.repeat(2000); // ~500 token_est
  const section2 = 'b'.repeat(2000); // ~500 token_est
  const section3 = 'c'.repeat(2000); // ~500 token_est
  const text = section1 + '\n## H1\n' + section2 + '\n## H2\n' + section3;
  // ~6020 chars = ~1505 token_est total, exceeds hardMax

  const chunks = chunkTurn({ ...baseTurn, text });
  assert.ok(chunks.length >= 2);

  // At least one chunk boundary should align with a `\n## ` marker:
  // i.e., chunks[i].text should start with `## ` (after the prefixed \n that
  // joined into the previous chunk) OR previous chunk should end at the \n
  // before a `## `. Accept either interpretation.
  const startsWithHeading = chunks.some((c, i) => i > 0 && /^## /.test(c.text));
  const prevEndsBeforeHeading = chunks.some((c, i) => i > 0 && /\n## /.test(chunks[i - 1].text + c.text.slice(0, 4)));
  assert.ok(startsWithHeading || prevEndsBeforeHeading, 'a chunk boundary should fall on a \\n## marker');
});

test('T2 chunker assigns sub_index when splitting', () => {
  const text = 'x'.repeat(5000); // 1250 token_est
  const chunks = chunkTurn({ ...baseTurn, text });
  assert.ok(chunks.length >= 2);
  // Sub-chunks should be distinguishable by an explicit sub_index field
  // so the indexer can derive a stable chunk identity.
  for (let i = 0; i < chunks.length; i++) {
    assert.equal(chunks[i].sub_index, i, `chunk ${i} should have sub_index=${i}`);
  }
});
