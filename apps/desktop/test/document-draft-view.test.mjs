import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftView } from '../lib/document-draft-view.mjs';

function fixture(t) {
  const nodes = new Map();
  const element = () => ({ dataset: {}, children: [], hidden: false, disabled: false,
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } });
  t.mock.property(globalThis, 'document', { createElement: element });
  const byId = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  let result = { ok: true, drafts: [], archived: [], capacity: { limit: 32, records: 0, maxRecords: 128 } };
  const calls = [], state = { confirmed: { source: 'Synthetic', revision: 4 }, source: 'Synthetic' };
  const api = { onDraftStatus() {}, listDrafts: async () => {
    if (result instanceof Error) throw result; return result;
  }, manageDraft: async request => { calls.push(request); return { ok: true }; } };
  const view = createDraftView({ api, byId, context: () => ({ state }), restore: async id => calls.push(id) });
  view.configure({ draftsEnabled: true });
  return { byId, view, api, state, calls, result: value => { result = value; } };
}
// DOM port only; no browser, filesystem or user draft library is used.
globalThis.document ||= {};
test('draft empty state appears only after a successful empty list, not on failure', async t => {
  const h = fixture(t); await h.view.refresh(); assert.equal(h.byId('draft-empty').hidden, false);
  h.result({ ok: false, code: 'EACCES' }); await h.view.refresh();
  assert.equal(h.byId('draft-empty').hidden, true); assert.equal(h.byId('draft-recovery-status').dataset.tone, 'error');
  assert.match(h.byId('draft-recovery-status').textContent, /已有记录保留/);
  h.result(Error('Synthetic IPC failure')); await h.view.refresh();
  assert.equal(h.byId('draft-empty').hidden, true); assert.match(h.byId('draft-recovery-status').textContent, /通信失败/);
});
test('draft cards retain literal names, identity and disabled actions for active or uncertain records', async t => {
  const h = fixture(t), drafts = [
    { id: 'active-01', label: '<synthetic>.md', active: true, revision: 4, recoverable: true },
    { id: 'warning-02', label: 'Same name', warning: true, revision: 2, recoverable: true },
    { id: 'unknown-03', label: 'Same name', recoverable: false }
  ];
  h.result({ ok: true, drafts, archived: [] }); await h.view.refresh();
  const rows = h.byId('draft-recovery-list').children;
  assert.equal(rows[0].children[0].textContent, '<synthetic>.md');
  assert.equal(rows[0].dataset.draftId, 'active-01'); assert.equal(rows[0].children[1].textContent, '正在使用');
  assert.equal(rows[1].children[1].textContent, '需要检查');
  assert.equal(rows[2].children[1].textContent, '无法恢复');
  assert.ok(rows.every(row => row.children.at(-1).children.at(-1).disabled));
  assert.equal(rows[2].children.at(-1).children[0].disabled, true);
});
test('pending draft management is single-flight and unknown results remain independently visible after refresh', async t => {
  const h = fixture(t), draft = { id: 'draft-01', label: 'Synthetic', revision: 4, recoverable: true, manageToken: 'token' };
  h.result({ ok: true, drafts: [draft], archived: [] }); await h.view.refresh();
  let reject; h.api.manageDraft = request => { h.calls.push(request); return new Promise((_, fail) => { reject = fail; }); };
  h.byId('draft-recovery-list').children[0].children.at(-1).children.at(-1).onclick();
  const request = h.byId('confirm-draft-management').onclick();
  assert.equal(h.byId('cancel-draft-management').disabled, true); assert.equal(h.byId('close-draft-dialog').disabled, true);
  await h.byId('confirm-draft-management').onclick(); assert.equal(h.calls.length, 1);
  reject(Error('Synthetic lost response')); await request;
  assert.equal(h.byId('close-draft-dialog').disabled, false);
  assert.equal(h.byId('draft-operation-status').dataset.tone, 'error');
  assert.match(h.byId('draft-operation-status').textContent, /结果未知/);
  await h.view.refresh(); assert.match(h.byId('draft-operation-status').textContent, /不自动重试/);
  assert.equal(h.state.confirmed.source, 'Synthetic'); assert.equal(h.state.confirmed.revision, 4);
});
