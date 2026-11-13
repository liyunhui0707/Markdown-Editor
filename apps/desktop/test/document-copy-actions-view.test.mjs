import test from 'node:test';
import assert from 'node:assert/strict';
import { createCopyActionsView } from '../lib/document-copy-actions-view.mjs';
function harness() {
  const nodes = new Map(), opened = [], shown = []; let loading = false, result;
  const state = { confirmed: { sessionId: 'A', revision: 7, source: 'later draft', temporary: true,
    confirmedCopy: { copyId: 'confirmed', ok: true, state: 'created-confirmed', revision: 3 } },
    source: 'later draft', recoveryRecords: [] };
  const byId = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  const view = createCopyActionsView({ byId, context: () => ({ selected: 'A', loading, controller: { state: () => state } }),
    open: async request => opened.push(request), api: { revealConfirmedCopy: async request => { shown.push(request); return result; } },
    busy: value => { loading = value; }, rerender: () => view.render() });
  view.render();
  return { byId, state, opened, shown, view, result: value => { result = value; } };
}
test('actions use main receipt ID/current revision only and preserve later writing', async () => {
  const h = harness(), before = structuredClone(h.state);
  await h.byId('open-confirmed-copy').onclick();
  assert.deepEqual(h.opened, [{ sessionId: 'A', expectedRevision: 7, copyId: 'confirmed' }]);
  h.result({ ok: true, copyId: 'confirmed' }); await h.byId('reveal-confirmed-copy').onclick();
  assert.deepEqual(h.shown, h.opened); assert.deepEqual(h.state, before);
  assert.match(h.byId('copy-action-status').textContent, /已请求/);
});
test('no confirmed receipt means no shortcut; earlier success remains separate from latest failure', () => {
  const h = harness(); h.state.confirmed.copyState = { ok: false, state: 'created-partial' }; h.view.render();
  assert.equal(h.byId('confirmed-copy-actions').hidden, false);
  h.state.confirmed.confirmedCopy = null; h.view.render(); assert.equal(h.byId('confirmed-copy-actions').hidden, true);
});
for (const patch of [{ composing: true }, { compositionInvalid: true }, { pending: 1 }, { historyPending: true },
  { locked: true }, { source: 'unconfirmed' }, { recoveryRecords: [{}] }]) test('input fence: ' + Object.keys(patch)[0], async () => {
  const h = harness(); Object.assign(h.state, patch); h.view.render();
  let prevented = false; h.byId('open-confirmed-copy').onpointerdown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.byId('open-confirmed-copy').disabled, true);
  await h.byId('open-confirmed-copy').onclick(); await h.byId('reveal-confirmed-copy').onclick();
  assert.deepEqual(h.opened, []); assert.deepEqual(h.shown, []);
});
test('failed Finder action never changes export confirmation or writing; stale messages do not leak to new receipts', async () => {
  const h = harness(), before = structuredClone(h.state);
  h.result({ ok: false, code: 'confirmed-copy-unavailable' }); await h.byId('reveal-confirmed-copy').onclick();
  assert.match(h.byId('copy-action-status').textContent, /无法验证/); assert.deepEqual(h.state, before);
  h.state.confirmed.confirmedCopy.copyId = 'new'; h.view.render(); assert.equal(h.byId('copy-action-status').textContent, '');
});
test('confirmed-close release drops only the named receipt notice',async()=>{
 const h=harness();h.result({ok:true,copyId:'confirmed'});await h.byId('reveal-confirmed-copy').onclick();
 h.view.release('other');h.view.render();assert.match(h.byId('copy-action-status').textContent,/已请求/);
 h.view.release('confirmed');h.view.render();assert.equal(h.byId('copy-action-status').textContent,'');
 assert.equal(h.state.confirmed.confirmedCopy.copyId,'confirmed');
});
