import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestCopyView } from '../lib/document-test-copy-view.mjs';

// Minimal DOM/controller ports; execute the real view's click/response handlers.
function harness() {
  const elements = new Map(), documents = new Map(), responses = [];
  let selected = 'A', frozen = false, calls = 0;
  const byId = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, disabled: false });
    return elements.get(id);
  };
  const add = id => {
    const state = { confirmed: { sessionId: id, source: `${id} text`, revision: 2,
      temporary: true, readOnly: false, copyEnabled: true, persistentCopyEnabled: true,
      copySha256: 'a'.repeat(64), dirty: true, canUndo: true, canRedo: false,
      copyState: { ok: true, state: 'not-created', created: false } },
    source: `${id} text`, locked: false, composing: false, pending: 0, historyPending: false, recoveryRecords: [] };
    const controller = { state: () => state, refresh: r => { state.confirmed = structuredClone(r.snapshot); } };
    documents.set(id, { state, controller });
  };
  add('A'); add('B');
  const context = () => ({ selected, controller: documents.get(selected).controller, loading: frozen });
  const api = { createPersistentCopy: async () => {
    ++calls;
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const before = documents.get(selected).state.confirmed;
    return typeof next === 'function' ? next(before) : { ok: next.ok, code: next.code, copy: next,
      snapshot: { ...structuredClone(before), copyState: next } };
  } };
  let view;
  const render = () => view.render(documents.get(selected).state);
  view = createTestCopyView({ api, byId, context, busy: value => { frozen = value; }, rerender: render, focus() {} });
  render();
  return { byId, documents, responses, render, calls: () => calls,
    select(id) { selected = id; render(); },
    async attempt(response) {
      responses.push(response); byId('create-test-copy').onclick();
      await byId('confirm-test-copy').onclick();
    },
    text: id => byId(id).textContent };
}
const confirmed = (revision = 2, name = 'A') => ({ ok: true, state: 'created-confirmed', created: true,
  revision, filePath: `/synthetic/${name}.md`, sha256: 'a'.repeat(64), byteLength: 6 });
const refused = code => ({ ok: false, state: code === 'target-exists' ? code : 'not-created', created: false, code });

test('no successful copy is invented before a confirmed receipt', () => {
  const h = harness();
  assert.equal(h.text('test-copy-result'), '');
  assert.equal(h.text('test-copy-operation'), '');
});
test('last confirmed path, revision and hash survive target-exists and cancellation', async () => {
  const h = harness(), before = structuredClone(h.documents.get('A').state.confirmed);
  await h.attempt(confirmed());
  const receiptText = h.text('test-copy-result');
  assert.match(receiptText, /revision 2/); assert.match(receiptText, /\/synthetic\/A.md/);
  assert.ok(receiptText.includes('a'.repeat(64)));
  for (const code of ['target-exists', 'create-cancelled']) {
    await h.attempt(refused(code));
    assert.equal(h.text('test-copy-result'), receiptText);
    assert.ok(h.text('test-copy-operation').includes(code));
    assert.doesNotMatch(h.text('test-copy-operation'), /created: revision/);
    assert.equal(h.byId('create-test-copy').disabled, false);
  }
  for (const key of ['source', 'revision', 'dirty', 'canUndo', 'canRedo']) {
    assert.equal(h.documents.get('A').state.confirmed[key], before[key]);
  }
});
test('last success and last operation remain isolated across A/B/A', async () => {
  const h = harness(); await h.attempt(confirmed());
  await h.attempt(refused('target-exists'));
  const textA = h.text('test-copy-result'); h.select('B');
  assert.equal(h.text('test-copy-result'), ''); assert.equal(h.text('test-copy-operation'), '');
  await h.attempt(refused('create-cancelled')); assert.equal(h.text('test-copy-result'), '');
  await h.attempt(confirmed(2, 'B')); assert.match(h.text('test-copy-result'), /\/synthetic\/B.md/);
  h.select('A'); assert.equal(h.text('test-copy-result'), textA);
  assert.match(h.text('test-copy-operation'), /target-exists/);
});
test('only a validated new success replaces the last confirmed revision', async () => {
  const h = harness(); await h.attempt(confirmed()); const old = h.text('test-copy-result');
  const s = h.documents.get('A').state;
  s.confirmed.revision = 3; s.confirmed.source += ' later'; s.source = s.confirmed.source; h.render();
  await h.attempt(refused('unsupported-copy-directory')); assert.equal(h.text('test-copy-result'), old);
  await h.attempt(confirmed(3, 'new')); assert.match(h.text('test-copy-result'), /revision 3/);
  assert.match(h.text('test-copy-result'), /\/synthetic\/new.md/);
  assert.equal(s.confirmed.dirty, true); assert.equal(s.confirmed.canUndo, true);
});
for (const [state, created] of [['created-partial', true], ['durability-uncertain', true], ['create-outcome-unknown', null]]) {
  test(`${state} keeps last success separate and blocks another attempt`, async () => {
    const h = harness(); await h.attempt(confirmed()); const old = h.text('test-copy-result');
    await h.attempt({ ok: false, state, created, code: state, filePath: '/synthetic/uncertain.md' });
    assert.equal(h.text('test-copy-result'), old);
    assert.ok(h.text('test-copy-operation').includes(state));
    assert.equal(h.byId('create-test-copy').disabled, true);
    h.byId('create-test-copy').onclick(); await h.byId('confirm-test-copy').onclick();
    assert.equal(h.calls(), 2);
  });
}
test('lost IPC response preserves last success and remains blocked', async () => {
  const h = harness(); await h.attempt(confirmed()); const old = h.text('test-copy-result');
  await h.attempt(Error('synthetic transport failure'));
  assert.equal(h.text('test-copy-result'), old);
  assert.match(h.text('test-copy-operation'), /create-outcome-unknown/);
  assert.equal(h.byId('create-test-copy').disabled, true);
});
test('a mismatched success cannot replace the verified receipt', async () => {
  const h = harness(); await h.attempt(confirmed()); const old = h.text('test-copy-result');
  await h.attempt(before => ({ ok: true, copy: confirmed(99, 'wrong'), snapshot: before }));
  assert.equal(h.text('test-copy-result'), old);
  assert.match(h.text('test-copy-operation'), /create-outcome-unknown/);
  assert.equal(h.byId('create-test-copy').disabled, true);
});
test('composition and unconfirmed drafts still refuse copy creation', () => {
  const h = harness(), s = h.documents.get('A').state;
  for (const kind of ['composition', 'draft']) {
    s.composing = kind === 'composition'; s.recoveryRecords = kind === 'draft' ? [{ source: 'unaccepted' }] : [];
    h.render(); assert.equal(h.byId('create-test-copy').disabled, true);
    h.byId('create-test-copy').onclick(); assert.equal(h.calls(), 0);
  }
});
