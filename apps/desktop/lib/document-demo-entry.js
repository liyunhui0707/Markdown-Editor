import { Editor, Extension, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { projectSource } from './document-source-map.mjs';
import { createTestCopyView } from './document-test-copy-view.mjs';
import { createEditController } from './document-edit-controller.mjs';

const api = window.documentDemo, byId = id => document.getElementById(id);
let controller = null, editor = null, resetting = false, loading = false, selected = null;
let switching = false, switchEpoch = 0, pendingSession = null, failedSession = null, navigationError = '';
const drafts = new Map(), lifecycles = new Map();
let readOnlyWindow = false;
const readOnlyDocument = () => controller?.state().confirmed.readOnly === true
  || (readOnlyWindow && controller?.state().confirmed.temporary !== true);
let compositionView = null, copyPanelOpen = false, copyMessage = '', copyEpoch = 0;
function renderCompositionCopies(s) {
  byId('composition-warning').hidden = !(s.compositionInvalid || ['unsafe-composition', 'composition-invalid'].includes(s.code));
  byId('composition-copy-panel').hidden = !copyPanelOpen;
  if (!copyPanelOpen) return;
  byId('composition-markdown').textContent = compositionView?.source ?? '';
  byId('composition-dom').textContent = compositionView?.visibleText ?? '';
  byId('composition-dom-note').textContent = compositionView?.visibleText == null
    ? 'DOM text was unavailable. Native IME preedit may not have been captured.'
    : 'Partial DOM plain text only; it may be incomplete and is not lossless Markdown.';
  byId('copy-composition-markdown').disabled = !compositionView;
  byId('copy-composition-dom').disabled = compositionView?.visibleText == null;
  byId('composition-copy-status').textContent = copyMessage;
}
function viewCompositionCopies() {
  if (!controller) return;
  let visibleText = null;
  try { visibleText = editor.view.dom.textContent; } catch { /* Preserve Markdown even if DOM cannot be read. */ }
  const result = controller.retainCompositionCopy(visibleText);
  ++copyEpoch; copyPanelOpen = true;
  if (result.ok) { compositionView = result.record; copyMessage = `Copy record ${result.record.id} retained in memory only.`; }
  else {
    copyMessage = result.code === 'recovery-capacity'
      ? 'Recovery capacity reached. Cannot retain new input. No earlier record was removed; any displayed copy is an earlier record.'
      : `Cannot retain a new copy: ${result.code}. No earlier record was removed.`;
  }
  renderCompositionCopies(controller.state());
}
async function copyComposition(kind) {
  if (!compositionView) return;
  const text = kind === 'Markdown' ? compositionView.source : compositionView.visibleText;
  if (text == null) return;
  const epoch = ++copyEpoch, active = controller, record = compositionView;
  try {
    await navigator.clipboard.writeText(text);
    if (epoch !== copyEpoch || active !== controller || record !== compositionView || !copyPanelOpen) return;
    copyMessage = `Copied ${kind === 'Markdown' ? 'local Markdown' : 'partial DOM text'}.`;
  } catch {
    if (epoch !== copyEpoch || active !== controller || record !== compositionView || !copyPanelOpen) return;
    copyMessage = 'Copy failed. Select the unchanged text below and copy it manually; no input was discarded.';
  }
  renderCompositionCopies(controller.state());
}
const activeInvalid = () => lifecycles.has(selected);
const testCopyView = createTestCopyView({ api, byId,
  context: () => ({ controller, selected, loading, invalid: activeInvalid() }),
  busy: value => { loading = value; }, rerender: () => { if (controller) render(controller.state()); },
  focus: () => { if (editor?.isEditable) editor.view.focus(); },
});
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
  byId('recovery').textContent = records.map(r => `Record ${r.id}: ${r.reason}; base revision ${r.baseRevision}; ${r.mainMatchesDraft ? 'snapshot matches' : 'not reapplied'}\n${r.source}${'visibleText' in r ? `\nPartial DOM text (possibly incomplete):\n${r.visibleText ?? '[unavailable]'}` : ''}`).join('\n\n----\n\n');
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
  const editable = !readOnlyDocument() && !activeInvalid() && !s.locked && !s.historyPending && !loading;
  if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  if (readOnlyWindow) {
    for (const id of ['open-file', 'empty-open', 'new-temporary']) byId(id).disabled = busy;
    const current = s.confirmed, temporary = current.temporary === true;
    byId('document-name').textContent = current.label; byId('document-full-name').textContent = current.label;
    byId('document-location').textContent = temporary ? 'In this window only — no saved file' : current.location;
    byId('document-info').querySelector('summary').title = current.label;
    byId('readonly-badge').textContent = temporary ? 'Not saved' : 'Read-only';
    byId('readonly-badge').title = temporary ? 'Temporary writing is memory only.' : 'Viewing only. Editing and saving are unavailable.';
    byId('document-info-note').textContent = temporary ? (current.copyEnabled ? 'Limited writing. Test copies are disposable; this document remains Not saved.' : 'Limited paragraph writing. No save or export is available.') : 'Read-only preview. Some Markdown formatting is shown as plain text.';
    byId('temporary-notice').hidden = !temporary;
    byId('documents').hidden = byId('documents').options.length < 2;
    document.title = current.label + (temporary ? ' — Not saved' : ' — Read-only');
    if (navigationError || activeInvalid() || s.locked) viewerStatus('Editing unavailable: ' + (navigationError || lifecycleCode(selected) || s.code) + '. Retained input copies remain in this window.', true);
  }
  testCopyView.render(s); renderCompositionCopies(s); show();
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
  if (!active || readOnlyDocument() || activeInvalid() || loading) return;
  await active.history(operation);
  if (controller === active && !activeInvalid() && !active.state().locked) editor.view.focus();
}
function install(snapshot) {
  if (lifecycles.has(snapshot.sessionId)) throw Error('Blocked session');
  projectSource(snapshot.source); // Validate before changing the active identity.
  controller?.dispose(); selected = snapshot.sessionId;
  compositionView = null; copyPanelOpen = false; copyMessage = ''; ++copyEpoch;
  controller = createEditController(snapshot, {
    send: (operation, data) => api[operation](data), onChange: render, onReset: resetSource,
    recoveryRecords: drafts.get(selected) || [],
  });
  if (!editor) {
    const gate = Extension.create({ name: 'verifiedSourceRange', addProseMirrorPlugins() {
      return [new Plugin({ filterTransaction(tr) {
        if (!resetting && tr.docChanged && (activeInvalid() || loading || readOnlyDocument())) { show(readOnlyDocument() ? 'read-only-document' : activeInvalid() ? 'session-invalidated' : 'document-loading'); return false; }
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
          // Chromium may report insertParagraph/isComposing=false while IME is still active.
          // Suppress that structural default, not the key/candidate or composition lifecycle.
          if (event.inputType === 'insertParagraph' && (event.isComposing || _view.composing || controller?.state().composing)) {
            event.preventDefault(); return true;
          }
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
    if (!lifecycles.has(id) && r.ok && r.snapshot?.sessionId === id) { install(r.snapshot); if (readOnlyWindow) viewerStatus('Document selected.'); }
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
// Capture before pointer focus changes can end/flush the native composition.
byId('view-composition-copy').onpointerdown = event => {
  if (event.button === 0) { event.preventDefault(); viewCompositionCopies(); }
};
byId('view-composition-copy').onclick = event => { if (event.detail === 0) viewCompositionCopies(); };
byId('cancel-composition-copy').onclick = () => {
  ++copyEpoch; copyPanelOpen = false; renderCompositionCopies(controller.state());
};
byId('copy-composition-markdown').onclick = () => copyComposition('Markdown');
byId('copy-composition-dom').onclick = () => copyComposition('DOM');
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
function viewerStatus(message, notice = false) {
  byId('viewer-status').textContent = message;
  byId('viewer-status').toggleAttribute('data-notice', notice);
}
async function openDocument(temporary = false) {
  const state = controller?.state();
  if (!readOnlyWindow || loading || state?.pending || state?.composing || state?.historyPending) return;
  loading = true; const epoch = ++switchEpoch;
  for (const id of ['open-file', 'empty-open', 'new-temporary']) byId(id).disabled = true;
  if (controller) render(controller.state());
  viewerStatus(temporary ? 'Creating temporary document…' : 'Opening…');
  let candidate = null;
  try {
    const r = await (temporary ? api.newTemporary() : api.openFile());
    if (epoch !== switchEpoch) return;
    if (!r.ok) {
      const messages = { 'open-cancelled': 'Open cancelled.', 'file-unavailable': 'The selected file no longer exists.',
        'read-failed': 'The selected file cannot be read.', 'unsupported-encoding': 'Only UTF-8 Markdown is supported.',
        'unsupported-size': 'The selected file exceeds the preview size limit.', 'parse-failed': 'This content exceeds the supported preview limits.',
        'unsupported-path': 'Choose one supported .md file.', 'unsupported-file': 'Choose a regular file, not a link.',
        'external-change': 'The file changed while it was being read.', 'session-limit': 'This window has reached its eight-document limit.' };
      viewerStatus((messages[r.code] || 'Unable to open the selected file.') + ' Current document unchanged.', true);
      return;
    }
    candidate = r.snapshot;
    if (!candidate || (temporary ? candidate.temporary !== true || candidate.readOnly !== false : candidate.readOnly !== true || typeof candidate.location !== 'string')
        || lifecycles.has(candidate.sessionId) || typeof candidate.label !== 'string') throw Error('Invalid read-only snapshot');
    const projection = projectSource(candidate.source);
    const schema = editor?.schema || getSchema([StarterKit.configure({ undoRedo: false, trailingNode: false })]);
    schema.nodeFromJSON(projection.doc).check(); // Validate before changing active identity/content.
    const previous = controller?.state().confirmed;
    navigationError = '';
    const option = document.createElement('option'); option.value = candidate.sessionId; option.textContent = candidate.label;
    byId('documents').append(option); install(candidate);
    byId('document-info').hidden = false; byId('document-info').open = false;
    byId('empty-state').hidden = true; document.body.dataset.documentState = 'open'; window.scrollTo(0, 0);
    if (previous?.readOnly && previous.sessionId !== candidate.sessionId) {
      try {
        const closed = await api.close({ sessionId: previous.sessionId, expectedRevision: previous.revision });
        if (closed.ok) [...byId('documents').options].find(o => o.value === previous.sessionId)?.remove();
      }
      catch { /* Old authority cannot grant write access; main will revoke it on close. */ }
    }
    viewerStatus(temporary ? 'Temporary document ready. Writing is not saved.' : 'Read-only preview. The original file has not been modified.');
  } catch {
    if (candidate && selected !== candidate.sessionId) {
      try { await api.close({ sessionId: candidate.sessionId, expectedRevision: candidate.revision }); } catch { /* main revokes on window close */ }
    }
    viewerStatus('Unable to display the selected file. Current document unchanged.', true);
  } finally {
    loading = false; for (const id of ['open-file', 'empty-open', 'new-temporary']) byId(id).disabled = false;
    if (controller) render(controller.state());
    if (temporary && candidate?.sessionId === selected && !activeInvalid()) editor?.view.focus();
  }
}
const openReadOnly = () => openDocument(false);
byId('new-temporary').onclick = () => openDocument(true);
byId('open-file').onclick = openReadOnly;
byId('empty-open').onclick = openReadOnly;
api.onOpenRequest(openReadOnly);
window.addEventListener('keydown', event => {
  if (readOnlyWindow && (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'o') {
    event.preventDefault(); void openReadOnly();
  }
});
api.onReady(data => {
  readOnlyWindow = data?.readOnlyWindow === true;
  if (readOnlyWindow) {
    document.body.dataset.documentViewer = 'true'; document.body.dataset.documentState = 'empty';
    byId('document-header').hidden = false; byId('empty-state').hidden = false; byId('empty-open').disabled = false;
    byId('writing-actions').hidden = false; byId('new-temporary').disabled = false;
    byId('writing-actions').append(byId('documents')); byId('documents').hidden = true; byId('documents').setAttribute('aria-label', 'Open documents');
    byId('open-file').disabled = false; document.title = 'Markdown — Read-only';
  } else byId('connect').disabled = false;
});
