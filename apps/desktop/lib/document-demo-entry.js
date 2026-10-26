import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { projectSource } from './document-source-map.mjs';
import { createEditController } from './document-edit-controller.mjs';

const api = window.documentDemo, byId = id => document.getElementById(id);
let controller = null, editor = null, resetting = false, loading = false, selected = null;
let switching = false, switchEpoch = 0, pendingSession = null, failedSession = null, navigationError = '';
const drafts = new Map(), lifecycles = new Map();
const activeInvalid = () => lifecycles.has(selected);
const lifecycleCode = id => lifecycles.get(id) === 'invalidated' ? 'unknown-session' : lifecycles.get(id);
function show(code) {
  const s = controller?.state(), current = s?.confirmed;
  byId('status').textContent = JSON.stringify({ code: code || navigationError || (switching ? 'switch-pending' : s?.code),
    editingCode: s?.code, navigationError: navigationError || null,
    lifecycle: lifecycles.get(selected) || 'open', historyPending: s?.historyPending, loading, switching,
    activeSessionId: selected, pendingSessionId: pendingSession, revision: current?.revision, dirty: current?.dirty,
    saveState: current?.saveState, pending: s?.pending, composing: s?.composing, locked: activeInvalid() || s?.locked,
    canUndo: current?.canUndo, canRedo: current?.canRedo });
}
function render(s) {
  const records = s.recoveryRecords;
  drafts.set(selected, records);
  byId('documents').value = selected;
  byId('source').textContent = s.confirmed.source;
  byId('recovery').textContent = records.map(r => `Record ${r.id}: ${r.reason}; base revision ${r.baseRevision}; ${r.mainMatchesDraft ? 'snapshot matches' : 'not reapplied'}\n${r.source}`).join('\n\n----\n\n');
  byId('recovery-panel').hidden = records.length === 0;
  byId('recovery-status').textContent = `${records.length} retained record(s). Confirmed Markdown is shown separately above.`;
  const recoveryId = byId('recovery-record').value;
  byId('recovery-record').replaceChildren(...records.map(r => {
    const o = document.createElement('option'); o.value = String(r.id); o.textContent = `Record ${r.id}: ${r.reason}`; return o;
  }));
  if (records.some(r => String(r.id) === recoveryId)) byId('recovery-record').value = recoveryId;
  const busy = loading || s.pending > 0 || s.composing || s.historyPending;
  for (const id of ['documents', 'reload', 'check', 'save']) byId(id).disabled = busy;
  for (const id of ['reload', 'check', 'save']) byId(id).disabled ||= activeInvalid();
  byId('undo').disabled = busy || activeInvalid() || s.locked || !s.confirmed.canUndo;
  byId('redo').disabled = busy || activeInvalid() || s.locked || !s.confirmed.canRedo;
  byId('discard-recovery').disabled = busy || records.length === 0;
  const editable = !activeInvalid() && !s.locked && !s.historyPending && !loading;
  if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  show();
}
function resetSource(source, selection) {
  if (!editor) return;
  const old = selection || { from: editor.state.selection.from, to: editor.state.selection.to };
  resetting = true;
  try {
    editor.commands.setContent(projectSource(source).doc, { emitUpdate: false, errorOnInvalidContent: true });
    const doc = editor.state.doc, clamp = n => Math.max(1, Math.min(n, doc.content.size - 1));
    const from = clamp(old.from), to = clamp(old.to);
    const next = doc.resolve(from).parent.inlineContent && doc.resolve(to).parent.inlineContent
      ? TextSelection.create(doc, from, to) : TextSelection.near(doc.resolve(from));
    editor.view.dispatch(editor.state.tr.setSelection(next));
  } finally { resetting = false; }
}
async function history(operation) {
  const active = controller;
  if (!active || activeInvalid() || loading) return;
  await active.history(operation);
  if (controller === active && !activeInvalid() && !active.state().locked) editor.view.focus();
}
function install(snapshot) {
  if (lifecycles.has(snapshot.sessionId)) throw Error('Blocked session');
  projectSource(snapshot.source); // Validate before changing the active identity.
  controller?.dispose(); selected = snapshot.sessionId;
  controller = createEditController(snapshot, {
    send: (operation, data) => api[operation](data), onChange: render, onReset: resetSource,
    recoveryRecords: drafts.get(selected) || [],
  });
  if (!editor) {
    const gate = Extension.create({ name: 'verifiedSourceRange', addProseMirrorPlugins() {
      return [new Plugin({ filterTransaction(tr) {
        if (!resetting && tr.docChanged && (activeInvalid() || loading)) { show(activeInvalid() ? 'session-invalidated' : 'document-loading'); return false; }
        return resetting || !tr.docChanged || controller.prepare(tr);
      } })];
    }, addKeyboardShortcuts() {
      return { 'Mod-z': () => { void history('undo'); return true; },
        'Mod-Shift-z': () => { void history('redo'); return true; } };
    } });
    editor = new Editor({ element: byId('editor'), content: projectSource(snapshot.source).doc, enableInputRules: false, enablePasteRules: false,
      extensions: [StarterKit.configure({ undoRedo: false, trailingNode: false }), gate],
      editorProps: { handleDOMEvents: {
        paste: (_view, event) => { event.preventDefault(); show('unsupported-paste'); return true; },
        drop: (_view, event) => { event.preventDefault(); show('unsupported-drop'); return true; },
        compositionstart: () => { if (activeInvalid()) return true; controller.beginComposition(); return false; },
        compositionend: () => {
          const active = controller;
          // Run after ProseMirror's end handler and its queued DOM mutation flush.
          queueMicrotask(() => queueMicrotask(() => { if (controller === active) active.endComposition(); }));
          return false;
        },
        beforeinput: (_view, event) => {
          if (!['historyUndo', 'historyRedo'].includes(event.inputType)) return false;
          event.preventDefault(); void history(event.inputType === 'historyUndo' ? 'undo' : 'redo'); return true;
        },
      } }, // Before ProseMirror's default clipboard/HTML parsing, not handlePaste.
      onUpdate: ({ transaction }) => { if (!resetting) controller.accept(transaction); } });
  } else resetSource(snapshot.source, { from: 1, to: 1 });
  render(controller.state());
}
async function load() {
  const id = byId('documents').value, s = controller?.state();
  if ((loading && !switching) || s?.pending || s?.composing || s?.historyPending) {
    byId('documents').value = selected || ''; show('document-busy'); return;
  }
  const epoch = ++switchEpoch;
  loading = true; switching = true; pendingSession = id; failedSession = null; navigationError = '';
  if (controller) render(controller.state());
  try {
    const r = await api.snapshot({ sessionId: id });
    if (epoch !== switchEpoch) return;
    if (!lifecycles.has(id) && r.ok && r.snapshot?.sessionId === id) install(r.snapshot);
    else { failedSession = id; navigationError = 'switch-failed:' + (lifecycleCode(id) || r.code || 'invalid-snapshot'); }
  } catch { if (epoch === switchEpoch) navigationError = 'switch-failed:ipc-failed'; }
  finally {
    if (epoch === switchEpoch) {
      loading = false; switching = false; pendingSession = null;
      byId('documents').value = selected || '';
      if (controller) render(controller.state()); else show();
    }
  }
}
byId('connect').onclick = async () => {
  const r = await api.list(); if (!r.ok) { show(r.code); return; }
  byId('documents').replaceChildren(...r.sessions.map(s => { const o = document.createElement('option'); o.value = s.sessionId; o.textContent = s.label; return o; }));
  byId('connect').disabled = true; await load();
};
byId('documents').onchange = load; byId('reload').onclick = () => { if (!activeInvalid() && !loading) return controller?.reload(); };
byId('undo').onclick = () => history('undo'); byId('redo').onclick = () => history('redo');
byId('discard-recovery').onclick = () => controller?.discardRecovery(Number(byId('recovery-record').value));
for (const operation of ['check', 'save']) byId(operation).onclick = async () => {
  if (!controller || activeInvalid()) return;
  const active = controller, s = active.state();
  if (s.pending || s.composing || s.historyPending || loading) return;
  loading = true; render(s);
  try {
    const r = await api[operation]({ sessionId: selected, ...(operation === 'save' ? { expectedRevision: s.confirmed.revision } : {}) });
    if (active === controller) active.refresh(r);
  } catch { show('ipc-failed'); }
  finally { loading = false; if (active === controller) render(active.state()); }
};
api.onLifecycle(({ sessionId, state }) => {
  lifecycles.set(sessionId, state); // No blocked ID returns to open on this page.
  if (pendingSession === sessionId) {
    ++switchEpoch; loading = false; switching = false; pendingSession = null;
    failedSession = sessionId;
  }
  if (failedSession === sessionId) navigationError = 'switch-failed:' + lifecycleCode(sessionId);
  else if (selected === sessionId) navigationError = state === 'invalidated' ? 'session-invalidated' : state;
  if (controller) render(controller.state()); else show();
});
api.onReady(() => { byId('connect').disabled = false; });
