import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloseView } from '../lib/document-close-view.mjs';
function fixture() {
  const state = { confirmed: { sessionId: 'a', revision: 2, source: 'Synthetic' }, source: 'Synthetic', recoveryRecords: [] };
  const c = { selected: 'a', controller: { state: () => state, refresh(reply) { state.confirmed = reply.snapshot; } } }, notices = [], requests = [], closed = [];
  const button = { ownerDocument: { querySelector: () => null } }; let finish, menu;
  const view = createCloseView({ byId: () => button, context: () => c,
    api: { onCloseRequest(fn) { menu = fn; }, closeDocument(data) { requests.push(data); return new Promise(r => { finish = r; }); } },
    busy(value) { c.loading = value; }, rerender() { view.sync(); },
    closed(id) { closed.push(id); }, report(text) { notices.push(text); } });
  view.configure();
  return { state, c, notices, requests, closed, button, view, menu: () => menu(), finish: value => finish(value) };
}
test('unconfirmed input, retained recovery and pending states never request closure', async () => {
  const f = fixture();
  for (const key of ['pending', 'composing', 'compositionInvalid', 'historyPending', 'locked']) {
    f.state[key] = true; f.view.sync(); await f.button.onclick(); assert.equal(f.button.disabled, true); f.state[key] = false;
  }
  f.state.recoveryRecords.push({ source: 'Unconfirmed' }); await f.button.onclick(); f.state.recoveryRecords = [];
  f.state.source = 'Not yet confirmed'; await f.button.onclick(); f.state.source = 'Synthetic';
  f.c.nativeComposing = true; await f.button.onclick();
  assert.equal(f.requests.length, 0); assert.equal(f.closed.length, 0);
});
test('cancel preserves the active controller; re-entry cannot issue a second close', async () => {
  const f = fixture(), controller = f.c.controller, pending = f.button.onclick();
  await f.button.onclick(); assert.equal(f.requests.length, 1); assert.equal(f.c.loading, true);
  f.finish({ ok: false, code: 'close-cancelled' }); await pending;
  assert.equal(f.c.controller, controller); assert.equal(f.c.loading, false); assert.equal(f.closed.length, 0);
  assert.match(f.notices.at(-1), /取消/);
});
test('only the matching confirmed close removes a document; stale success preserves current content', async () => {
  for (const sessionId of ['a', 'b']) {
    const f = fixture(), pending = f.button.onclick();
    f.finish({ ok: true, closed: true, sessionId, requestRevision: 2 }); await pending;
    assert.deepEqual(f.closed, sessionId === 'a' ? ['a'] : []);
  }
});
test('modal-owned interaction cannot be interrupted by the close menu', () => {
  const f = fixture(); f.button.ownerDocument.querySelector = () => ({}); f.menu();
  assert.equal(f.requests.length, 0);
});


test('matched cancellation refreshes backup evidence without replacing the controller', async () => {
  const f = fixture(), controller = f.c.controller, pending = f.button.onclick();
  const snapshot = { ...f.state.confirmed, draftBackup: { state: 'backed-up', revision: 2 }, canUndo: true };
  f.finish({ ok: false, closed: false, sessionId: 'a', requestRevision: 2, code: 'close-cancelled', snapshot }); await pending;
  assert.equal(f.c.controller, controller); assert.deepEqual(f.state.confirmed, snapshot);
});
