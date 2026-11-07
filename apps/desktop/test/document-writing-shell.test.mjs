import test from 'node:test';
import assert from 'node:assert/strict';
import { createWritingShell } from '../lib/document-writing-shell.mjs';
function fixture() {
  const nodes = new Map(), c = { loading: false, state: { pending: 0, composing: false } };
  let generated = 0;
  const doc = { events: {}, activeElement: null, modal: null, createElement: () => byId('generated-' + ++generated),
    addEventListener(k, v) { this.events[k] = v; }, querySelector() { return this.modal; } };
  const byId = id => {
    if (!nodes.has(id)) {
      const events = {}, attrs = {};
      const n = { hidden: false, open: false, disabled: false, attrs, events, dataset: {}, value: '', textContent: '',
        options: [], children: [], ownerDocument: doc,
        append(...items) { this.children.push(...items); }, prepend(...items) { this.children.unshift(...items); },
        remove() { for (const node of nodes.values()) node.children = node.children.filter(child => child !== this); },
        focus() { this.focused = true; doc.activeElement = this; },
        contains(node) { return this === node || this.children.some(child => child.contains(node)); },
        querySelector() { const child = byId(id + '-summary'); if (!this.children.includes(child)) this.append(child); return child; },
        setAttribute: (k, v) => { attrs[k] = v; }, addEventListener: (k, v) => { events[k] = v; },
        showModal() { this.open = true; }, close() { this.open = false; events.close?.(); },
        click() { if (!this.disabled) this.onclick?.(); } };
      nodes.set(id, n);
    } return nodes.get(id);
  };
  byId('test-copy-confirmation').hidden = true;
  const shell = createWritingShell({ byId, context: () => c }); shell.configure();
  return { c, byId, shell };
}
test('panels never steal focus during composition or a pending operation', () => {
  const { c, byId, shell } = fixture();
  for (const field of ['composing', 'compositionInvalid', 'pending', 'historyPending']) {
    c.state[field] = 1; shell.sync(); let prevented = false;
    byId('show-drafts').onpointerdown({ preventDefault() { prevented = true; } }); byId('show-drafts').onclick();
    assert.equal(prevented, true); assert.equal(byId('draft-dialog').open, false); assert.equal(c.state[field], 1);
    c.state[field] = false;
  }
  shell.sync(); byId('show-drafts').click(); assert.equal(byId('draft-dialog').open, true);
  shell.closePanels(); assert.equal(byId('draft-dialog').open, false); assert.equal(byId('show-drafts').attrs['aria-expanded'], 'false');
});
test('Escape cancels only through existing copy handler and cannot dismiss pending IPC', () => {
  const { c, byId, shell } = fixture(); let cancellations = 0;
  byId('cancel-test-copy').onclick = () => { ++cancellations; byId('test-copy-confirmation').hidden = true; c.loading = false; shell.sync(); };
  byId('test-copy-confirmation').hidden = false; c.loading = true; shell.sync();
  assert.equal(byId('copy-confirm-dialog').open, true);
  const event = { preventDefault() { this.prevented = true; } };
  byId('cancel-test-copy').disabled = true; byId('copy-confirm-dialog').events.cancel(event);
  assert.equal(event.prevented, true); assert.equal(cancellations, 0); assert.equal(c.loading, true);
  assert.equal(byId('copy-confirm-dialog').open, true);
  byId('cancel-test-copy').disabled = false; byId('copy-confirm-dialog').events.cancel(event);
  assert.equal(cancellations, 1); assert.equal(byId('copy-confirm-dialog').open, false);
});

function sessionFixture() {
  const f = fixture(), { c, byId, shell } = f;
  c.state.confirmed = { sessionId: 'original', label: '<original>.md', source: 'Original 文本', readOnly: true };
  byId('documents').options = [{ value: 'original', textContent: '<original>.md' }, { value: 'draft', textContent: '编辑副本.md' }];
  byId('documents').value = 'original'; shell.sync();
  const row = id => byId('session-list').children.find(n => n.dataset.sessionId === id);
  return { ...f, row };
}
test('sidebar uses real session IDs and text labels, highlights only the confirmed identity', async () => {
  const { c, byId, shell, row } = sessionFixture(); let calls = 0, finish;
  const original = c.state.confirmed;
  byId('documents').onchange = () => {
    ++calls; c.loading = true; c.pendingSession = byId('documents').value; shell.sync();
    return new Promise(resolve => { finish = () => { c.loading = false; c.pendingSession = null; byId('documents').value = 'original'; shell.sync(); resolve(); }; });
  };
  assert.equal(row('original').children[0].textContent, '<original>.md');
  assert.equal(row('original').attrs['aria-current'], 'true');
  const request = row('draft').onclick();
  assert.equal(calls, 1); assert.equal(row('original').attrs['aria-current'], 'true');
  assert.equal(row('draft').attrs['aria-current'], 'false'); assert.equal(row('draft').children[1].textContent, '正在切换…');
  row('draft').onclick(); assert.equal(calls, 1);
  finish(); await request;
  assert.equal(c.state.confirmed, original); assert.equal(row('original').attrs['aria-current'], 'true');
  byId('documents').onchange = () => { c.state.confirmed = { sessionId: 'draft', source: 'Edited', temporary: true }; shell.sync(); };
  row('draft').onclick(); assert.equal(row('draft').attrs['aria-current'], 'true');
  assert.equal(row('draft').children[1].textContent, '独立草稿');
});
test('sidebar guards pending/composition states and ignores revoked or removed sessions', () => {
  const { c, byId, shell, row } = sessionFixture(); let calls = 0;
  byId('documents').onchange = () => { ++calls; };
  for (const field of ['composing', 'compositionInvalid', 'pending', 'historyPending']) {
    c.state[field] = 1; shell.sync(); let prevented = false;
    row('draft').onpointerdown({ preventDefault() { prevented = true; } }); row('draft').onclick();
    assert.equal(prevented, true); assert.equal(calls, 0); assert.equal(byId('documents').value, 'original');
    assert.equal(byId('session-filter').disabled, true); c.state[field] = 0;
  }
  c.unavailable = id => id === 'draft'; shell.sync();
  row('draft').onclick(); assert.equal(calls, 0); assert.equal(row('draft').disabled, true);
  c.unavailable = () => false; shell.sync(); const stale = row('draft');
  byId('documents').options.pop(); shell.sync(); stale.onclick();
  assert.equal(calls, 0); assert.equal(row('draft'), undefined);
  assert.equal(byId('session-count').textContent, '1');
});
test('filter and frequent status updates preserve row nodes and never switch the editor', () => {
  const { c, byId, shell, row } = sessionFixture(); let calls = 0;
  byId('documents').onchange = () => { ++calls; };
  const sameRow = row('draft'); byId('session-filter').value = '编辑'; byId('session-filter').oninput();
  assert.equal(row('original').hidden, true); assert.equal(row('draft').hidden, false);
  c.state.confirmed.revision = 2; shell.sync(); assert.equal(row('draft'), sameRow); assert.equal(calls, 0);
  byId('session-filter').value = 'missing'; byId('session-filter').oninput();
  assert.equal(byId('session-empty').hidden, false); assert.equal(byId('documents').value, 'original');
  assert.match(byId('document-statistics').textContent, /字符 · Markdown/);
});

test('draft panel close and Escape preserve pending management, then cancel through the existing action', () => {
  const { byId } = fixture(); let cancellations = 0;
  byId('cancel-draft-management').onclick = () => { cancellations++; };
  byId('show-drafts').click(); byId('cancel-draft-management').disabled = true;
  const event = { preventDefault() { this.prevented = true; } };
  byId('close-draft-dialog').onclick(); byId('draft-dialog').events.cancel(event);
  assert.equal(event.prevented, true); assert.equal(byId('draft-dialog').open, true); assert.equal(cancellations, 0);
  byId('cancel-draft-management').disabled = false; byId('draft-dialog').events.cancel(event);
  assert.equal(byId('draft-dialog').open, false); assert.equal(cancellations, 1);
});
test('document details use confirmed identity and distinguish a draft from a file without changing it', () => {
  const { c, byId, shell } = sessionFixture();
  c.state.confirmed.location = '/synthetic/original'; c.state.confirmed.revision = 3;
  const original = structuredClone(c.state.confirmed); shell.sync();
  assert.equal(byId('details-document-name').textContent, '<original>.md');
  assert.equal(byId('details-document-location').textContent, '/synthetic/original');
  assert.equal(byId('details-backup-card').hidden, true); assert.deepEqual(c.state.confirmed, original);
  c.state.confirmed = { ...original, sessionId: 'draft', temporary: true, readOnly: false };
  shell.sync(); assert.equal(byId('details-document-kind').textContent, '独立草稿');
  assert.equal(byId('details-document-revision').textContent, '3'); assert.equal(byId('details-backup-card').hidden, false);
  assert.doesNotMatch(byId('details-document-location').textContent, /synthetic/);
  for(const dirty of [false,true]){
    c.state.confirmed={...c.state.confirmed,dirty,originalSave:{filePath:'/synthetic/bound.md',lastConfirmed:{revision:3}}};
    const before=structuredClone(c.state.confirmed);shell.sync();
    assert.equal(byId('details-document-kind').textContent,dirty?'文件草稿 · 修改未保存':'文件草稿 · 正文已保存');
    assert.equal(byId('details-document-location').textContent,'/synthetic/bound.md');
    assert.deepEqual(c.state.confirmed,before);
  }
});

test('title popup Escape returns focus without changing document state', () => {
  const { c, byId } = sessionFixture(), popup = byId('document-info'), doc = popup.ownerDocument;
  const title = popup.querySelector('summary'), state = structuredClone(c.state);
  popup.open = true; title.focus();
  const event = { key: 'Escape', preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  doc.events.keydown?.(event);
  assert.equal(popup.open, false); assert.equal(doc.activeElement, title);
  assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.deepEqual(c.state, state);
});
test('title popup outside pointer dismisses without consuming the destination click or focus', () => {
  const { byId } = sessionFixture(), popup = byId('document-info'), doc = popup.ownerDocument;
  const target = byId('editor'); target.focus(); popup.open = true;
  const inside = popup.querySelector('summary'); doc.events.pointerdown?.({ target: inside }); assert.equal(popup.open, true);
  doc.events.pointerdown?.({ target, preventDefault() { assert.fail('Must not consume outside pointer'); } });
  assert.equal(popup.open, false); assert.equal(doc.activeElement, target);
});
test('title dismissal leaves composing, pending and modal-owned interactions alone', () => {
  const { c, byId } = sessionFixture(), popup = byId('document-info'), doc = popup.ownerDocument;
  popup.open = true;
  const event = { key: 'Escape', target: byId('editor'), preventDefault() { assert.fail('Must not consume protected event'); }, stopPropagation() { assert.fail('Must not stop protected event'); } };
  for (const flag of ['composing', 'compositionInvalid', 'pending', 'historyPending']) {
    c.state[flag] = 1; doc.events.keydown?.(event); doc.events.pointerdown?.(event);
    assert.equal(popup.open, true); c.state[flag] = 0;
  }
  c.loading = true; doc.events.keydown?.(event); doc.events.pointerdown?.(event); assert.equal(popup.open, true); c.loading = false;
  doc.modal = byId('reading-settings-dialog'); doc.events.keydown?.(event); doc.events.pointerdown?.(event); assert.equal(popup.open, true);
  doc.modal = null;
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    doc.events.keydown?.({ ...event, ...extra }); assert.equal(popup.open, true);
  }
});


test('confirmed export shortcuts belong to the scrollable writing area beside the receipt', () => {
  const { byId } = fixture(), contents = byId('document-scroll').children;
  const actions = contents.indexOf(byId('confirmed-copy-actions'));
  assert.ok(actions > contents.indexOf(byId('copy-summary-compact')));
  assert.ok(actions < contents.indexOf(byId('editor')));
});
