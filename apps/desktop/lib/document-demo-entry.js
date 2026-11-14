import {filePresentation} from './document-file-presentation.mjs';
import {createLinkedFileView} from './document-linked-file-view.mjs';
import {createAccessibilityView} from './document-accessibility-view.mjs';
import { createNativeOpenView } from './document-native-open-view.mjs';
import { createInputPressureView } from './document-input-pressure-view.mjs';
import {createImagePreviews} from './document-image-preview.mjs';
import {createImageView} from './document-image-view.mjs';
import {createTableView} from './document-table-view.mjs';
import { createNameView } from './document-name-view.mjs';
import { createCloseView } from './document-close-view.mjs';
import { createFindPlugin, createFindView } from './document-find-view.mjs';
import { createSourceEditor } from './document-source-editor.mjs';
import { createSourceView } from './document-source-view.mjs';
import { createReadingView } from './document-reading-view.mjs';
import { createFormatView } from './document-format-view.mjs';
import { Editor, Extension, getSchema } from '@tiptap/core';
import { documentEditorExtensions } from './document-editor-extensions.mjs';
import { Plugin, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { projectSource } from './document-source-map.mjs';
import { createCopyActionsView } from './document-copy-actions-view.mjs';
import { createOriginalSaveView } from './document-original-save-view.mjs';
import { createTestCopyView } from './document-test-copy-view.mjs';
import { createEditController } from './document-edit-controller.mjs';
import { pastePlainText } from './document-plain-paste.mjs';
import { replaceParagraphRangeInput } from './document-paragraph-input.mjs';
import { createWritingShell } from './document-writing-shell.mjs';
import { createRecentView } from './document-recent-view.mjs';
import { createDraftView } from './document-draft-view.mjs';
import { syncNativeBackspaceSelection, syncNativeListSelection } from './document-native-selection.mjs';

import { applyBlockShortcut, applyStructuredKey, applyTaskToggle } from './document-block-input.mjs';
import { createLinkView } from './document-link-view.mjs';

const api = window.documentDemo, byId = id => document.getElementById(id);
let controller = null, editor = null, resetting = false, loading = false, selected = null;
let switching = false, switchEpoch = 0, pendingSession = null, failedSession = null, navigationError = '';
const drafts = new Map(), lifecycles = new Map();
const formatView = createFormatView({byId,context:()=>({controller,editor,state:controller?.state(),loading,invalid:activeInvalid()}),report:viewerStatus});
const tableView=createTableView({byId,context:()=>({controller,editor,state:controller?.state(),loading,invalid:activeInvalid()}),report:viewerStatus});
const imagePreviews=createImagePreviews({api,context:()=>({state:controller?.state(),loading})});
const imageView=createImageView({api,byId,context:()=>({controller,editor,state:controller?.state(),loading,invalid:activeInvalid()}),report:viewerStatus});
const linkView = createLinkView({byId,context:()=>({controller,editor,state:controller?.state(),loading,invalid:activeInvalid()}),report:viewerStatus});
const readingView = createReadingView({ byId, context: () => ({ editor, state: controller?.state(), loading, invalid: activeInvalid() }) });
const sourceView = createSourceView({ byId, createEditor:createSourceEditor, context: () => ({ controller, editor, state: controller?.state(), loading, invalid: activeInvalid(),
  sourceSelection:()=>{const at=editor.state.selection.from,span=projectSource(controller.state().source).spans.find(s=>at>=s.from&&at<=s.to);return span?span.sourceFrom+at-span.from:0;},
  restoreSelection:at=>{const source=controller.state().source,span=projectSource(source).spans.find(s=>at>=s.sourceFrom&&at<=s.sourceTo);if(span)resetSource(source,{from:span.from+at-span.sourceFrom,to:span.from+at-span.sourceFrom});}
}) });
const accessibility = createAccessibilityView({byId,context:()=>({editor,state:controller?.state(),loading})});
const writingShell = createWritingShell({ byId, reading: readingView, sourceView, context: () => ({ state: controller?.state(), loading, selected, pendingSession, unavailable: id => lifecycles.has(id) }), refreshDrafts: () => draftView.refresh() });
const findView = createFindView({ byId, context: () => ({ controller, editor, state: controller?.state(), loading, invalid: activeInvalid() }) });
const draftView = createDraftView({ api, byId, context: () => ({ hasSession:id=>[...byId('documents').options].some(o=>o.value===id), state: controller?.state(), loading, invalid: activeInvalid() }), restore: id => openDocument(true, false, id) });
const recentView = createRecentView({ api, byId, context: () => ({ state: controller?.state(), loading, invalid: activeInvalid() }), open: id => openDocument(false, false, null, null, id), restore: id => openDocument(true, false, id) });
const nameView = createNameView({ api, byId,
  context: () => ({ controller, editor, state: controller?.state(), loading, invalid: activeInvalid(), nativeComposing: editor?.view.composing }),
  busy: value => { loading = value; }, rerender: () => { if (controller) render(controller.state()); },
  changed: (id, label) => {
    const option = [...byId('documents').options].find(o => o.value === id); if (option) option.textContent = label;
    void draftView.refresh(); void recentView.refresh();
  }
});
const nativeOpenView = createNativeOpenView({ api, byId,
  canOpen: () => {
    const s = controller?.state();
    return readOnlyWindow && !loading && !switching && !activeInvalid() && !editor?.view.composing
      && !document.querySelector('dialog[open]') && !s?.pending && !s?.composing && !s?.compositionInvalid
      && !s?.locked && !s?.historyPending && !s?.recoveryRecords.length;
  },
  open: id => openDocument(false, false, null, null, null, id),
});
function persistentCopyNote(receipt) {
  if (receipt?.ok === true && receipt.state === 'created-confirmed' && receipt.created === true
      && Number.isSafeInteger(receipt.revision) && receipt.revision >= 0) {
    return `已确认文件副本：修订 ${receipt.revision}。不包含后续编辑；当前为独立草稿。`;
  }
  if (receipt && receipt.created !== false && receipt.state !== 'not-created') {
    return '创建结果未确认，文件可能已存在。当前草稿仍保留，请勿重复创建。';
  }
  return '尚无已确认的文件副本。当前为独立草稿。';
}
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
const inputPressure = createInputPressureView({ byId, context: () => ({ controller, state: controller?.state(), invalid: activeInvalid(), loading }), focus: () => editor?.view.focus() });
const copyActionsView = createCopyActionsView({ api, byId,
  context: () => ({ controller, selected, loading, invalid: activeInvalid() }),
  open: request => openDocument(false, false, null, request),
  busy: value => { loading = value; }, rerender: () => { if (controller) render(controller.state()); },
});
const testCopyView = createTestCopyView({ api, byId,
  context: () => ({ controller, selected, loading, invalid: activeInvalid() }),
  busy: value => { loading = value; }, rerender: () => { if (controller) render(controller.state()); },
  focus: () => { if (editor?.isEditable) editor.view.focus(); },
});
const linkedFileView=createLinkedFileView({api,byId,context:()=>({controller,selected,loading,invalid:activeInvalid()}),
  busy:value=>{loading=value;},rerender:()=>{if(controller)render(controller.state());},
  open:request=>openDocument(false,false,null,null,null,null,request)});
const originalSaveView = createOriginalSaveView({api,byId,
  context:()=>({controller,selected,loading,invalid:activeInvalid()}),busy:value=>{loading=value;},
  rerender:()=>{if(controller)render(controller.state());},focus:()=>{if(editor?.isEditable)editor.view.focus();}});
const closeView = createCloseView({ api, byId,
  context: () => ({ controller, selected, loading, invalid: activeInvalid(), nativeComposing: editor?.view.composing }),
  busy: value => { loading = value; }, report: viewerStatus, closed: finishDocumentClose,
  rerender: () => { if (controller) render(controller.state()); else { writingShell.sync(); recentView.sync(); closeView.sync(); nativeOpenView.sync(); show(); } },
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
  drafts.set(selected, s.recoveryRecords);
  const records = s.recoveryRecords.filter(r => r.reason !== 'edit-queue-full');
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
  for(const button of editor?.view.dom.querySelectorAll('.document-task-toggle')||[]) {
    button.disabled=!editable||s.composing||s.compositionInvalid||s.recoveryRecords.length>0;
    button.setAttribute('aria-disabled',String(button.disabled));
  }
  if (readOnlyWindow) {
    for (const id of ['open-file', 'empty-open', 'new-temporary']) byId(id).disabled = busy;
    const current = s.confirmed, temporary = current.temporary === true;
    byId('edit-copy').hidden = current.readOnly !== true || current.editCopyEnabled !== true;
    byId('edit-copy').disabled = busy || activeInvalid() || s.locked || s.recoveryRecords.length > 0;
    byId('document-name').textContent = current.label; byId('document-full-name').textContent = current.label;
    byId('document-location').textContent = temporary ? (current.originalSave?.available ? '保存目标：'+current.originalSave.filePath : '独立编辑副本 · 尚未关联文件') : current.location;
    byId('document-info').querySelector('summary').title = current.label;
    byId('readonly-badge').textContent = filePresentation(current,s).label;
    byId('readonly-badge').title = temporary ? '本地备份与另存文件是不同状态，请查看旁边的备份提示。' : '原文只读；编辑副本可通过保存按钮写回支持的本地文件。';
    byId('document-info-note').textContent = temporary ? (current.originalSave?.available ? '已关联文件。保存需点击保存；磁盘检查和打开磁盘版在详情中。另存新文件不会覆盖已有目标。' : current.persistentCopyEnabled ? persistentCopyNote(current.copyState) : current.copyEnabled ? 'Limited writing. Test copies are disposable; this document remains Not saved.' : 'Limited paragraph writing. No save or export is available.') : '原文件只读。暂不支持的 Markdown 格式按原文显示。';
    byId('temporary-notice').hidden = !temporary;
    byId('documents').hidden = byId('documents').options.length < 2;
    document.title = current.label + (temporary ? ' — 草稿' : ' — 原文只读');
    if (s.inputPaused && !navigationError && !activeInvalid()) viewerStatus('');
    else if (navigationError || activeInvalid() || s.locked) viewerStatus('Editing unavailable: ' + (navigationError || lifecycleCode(selected) || s.code) + '. Retained input copies remain in this window.', true);
    else if (['unsafe-source-range','unsafe-format-range'].includes(s.code)) viewerStatus('此处暂不支持该修改，原有内容已保留。请在受支持的段落、标题、紧凑列表、普通表格单元格、引用或基本代码块内编辑；复杂 Markdown 可通过「源码」编辑。', true);
    else if (s.code === 'memory-edited') viewerStatus(current.originalSave?.available ? '修改保留在草稿中，点击保存后写回文件。' : '修改保留在当前草稿中，原文件未改写。');
  }
  byId('composition-status').hidden = !s.composing || readOnlyWindow;
  inputPressure.sync(); draftView.render(s); testCopyView.render(s); originalSaveView.render(s); linkedFileView.render(); copyActionsView.render(); renderCompositionCopies(s); writingShell.sync(); recentView.sync(); nameView.sync(); formatView.sync();tableView.sync(); linkView.sync();imageView.sync(); imagePreviews.sync(); findView.sync(); closeView.sync(); nativeOpenView.sync(); accessibility.sync(); show();
}
function resetSource(source, selection) {
  if (!editor) return;
  const old = selection || { from: editor.state.selection.from, to: editor.state.selection.to };
  resetting = true;
  try {
    editor.commands.setContent(projectSource(source).doc, { emitUpdate: false, errorOnInvalidContent: true });
    const doc = editor.state.doc, clamp = n => Math.max(1, Math.min(n, doc.content.size - 1));
    const from = clamp(old.from), to = clamp(old.to);
    const imageAt=Number.isInteger(old.from)&&old.from>=0&&old.from<doc.content.size&&doc.nodeAt(old.from)?.type.name==='documentImage'&&old.to===old.from+1;
    const next = imageAt ? NodeSelection.create(doc,old.from) : doc.resolve(from).parent.inlineContent && doc.resolve(to).parent.inlineContent
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
function protectOpaqueBlocks(state) {
  const decorations = [];
  // projectSource represents unsupported syntax verbatim as codeBlock nodes.
  // Do not let native IME start editing them only to lose its end event when
  // the source-range gate rejects/redraws that mutation. The gate remains final.
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock' && !node.attrs.sourceEditable) decorations.push(Decoration.node(pos, pos + node.nodeSize,
      { contenteditable: 'false', 'aria-readonly': 'true', title: '此 Markdown 块暂不支持编辑，原文已保留。' }));
  });
  return DecorationSet.create(state.doc, decorations);
}
function finishCompositionForPointer(view, event) {
  const s = controller?.state();
  if (event.button !== 0 || !s?.composing || loading || activeInvalid() || readOnlyDocument()) return false;
  if (s.compositionInvalid && !controller.retainCompositionCopy(view.dom.textContent).ok) {
    event.preventDefault(); viewerStatus('Cannot protect more input copies. Composition remains blocked; no earlier record was removed.', true);
    return true;
  }
  // PM's mousedown clears its own composing flag without necessarily ending the
  // browser IME. Ask the browser to finish before PM moves the selection. Only
  // the actual compositionend path may commit/clear controller or preload state.
  view.dom.blur();
  return false; // Keep the normal pointer selection/focus behavior.
}
function install(snapshot) {
  if (lifecycles.has(snapshot.sessionId)) throw Error('Blocked session');
  projectSource(snapshot.source); // Validate before changing the active identity.
  controller?.dispose(); selected = snapshot.sessionId;
  compositionView = null; copyPanelOpen = false; copyMessage = ''; ++copyEpoch;
  controller = createEditController(snapshot, {
    send: (operation, data) => operation==='source-edit'?api.sourceEdit(data):api[operation](data), onChange: render, onReset: resetSource,
    recoveryRecords: drafts.get(selected) || [],
  });
  if (!editor) {
    const gate = Extension.create({ name: 'verifiedSourceRange', addProseMirrorPlugins() {
      return [createFindPlugin(), new Plugin({ props: { decorations: protectOpaqueBlocks }, filterTransaction(tr) {
        if (!resetting && tr.docChanged && (activeInvalid() || loading || readOnlyDocument())) { show(readOnlyDocument() ? 'read-only-document' : activeInvalid() ? 'session-invalidated' : 'document-loading'); return false; }
        return resetting || !tr.docChanged || controller.prepare(tr);
      } })];
    }, addKeyboardShortcuts() {
      return { 'Mod-z': () => { void history('undo'); return true; },
        'Mod-Shift-z': () => { void history('redo'); return true; } };
    } });
    editor = new Editor({ element: byId('editor'), content: projectSource(snapshot.source).doc, enableInputRules: false, enablePasteRules: false,
      extensions: [...documentEditorExtensions((view,position)=>applyTaskToggle(view,position,{controller,loading,invalid:activeInvalid()}),imagePreviews.nodeView), gate],
      editorProps: { attributes: { tabindex: '0' }, handleDOMEvents: {
        keydown: (view, event) => {
          syncNativeListSelection(view,event,{state:controller?.state(),blocked:activeInvalid()||loading||readOnlyDocument()});
          if (imageView.key(view,event)) return true;
          if (tableView.key(view,event)) return true;
          if (applyStructuredKey(view,event,{controller,loading,invalid:activeInvalid(),report:viewerStatus})) return true;
          if (applyBlockShortcut(view,event,{controller,loading,invalid:activeInvalid()})) return true;
          syncNativeBackspaceSelection(view, event, { state: controller?.state(), blocked: activeInvalid() || loading || readOnlyDocument() });
          if (replaceParagraphRangeInput(view, event, { state: controller?.state(),
            blocked: activeInvalid() || loading || readOnlyDocument(), report: viewerStatus })) return true;
          if (linkView.key(view,event)) return true;
          if (formatView.key(view, event)) return true;
          return false; // Existing Tiptap Backspace command and source gate perform the edit.
        },
        mousedown: finishCompositionForPointer,
        paste: (view, event) => pastePlainText(view, event, { state: controller?.state(),
          blocked: activeInvalid() || loading || readOnlyDocument(), report: viewerStatus }),
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
          if (replaceParagraphRangeInput(_view, event, { state: controller?.state(),
            blocked: activeInvalid() || loading || readOnlyDocument(), report: viewerStatus })) return true;
          if (!['historyUndo', 'historyRedo'].includes(event.inputType)) return false;
          event.preventDefault(); void history(event.inputType === 'historyUndo' ? 'undo' : 'redo'); return true;
        },
      } }, // Before ProseMirror's default clipboard/HTML parsing, not handlePaste.
      onTransaction: () => queueMicrotask(() => findView.sync()),
      onSelectionUpdate: () => {formatView.sync();tableView.sync();linkView.sync();imageView.sync();},
      onUpdate: ({ transaction }) => { if (!resetting) controller.accept(transaction); } });
  } else resetSource(snapshot.source, { from: 1, to: 1 });
  render(controller.state());
}
async function load() {
  const id = byId('documents').value, s = controller?.state();
  if ((loading && !switching) || s?.pending || s?.composing || s?.historyPending) {
    byId('documents').value = selected || ''; writingShell.sync(); recentView.sync(); show('document-busy'); return;
  }
  const epoch = ++switchEpoch;
  loading = true; switching = true; pendingSession = id; failedSession = null; navigationError = '';
  if (controller) render(controller.state());
  try {
    const r = await api.snapshot({ sessionId: id });
    if (epoch !== switchEpoch) return;
    if (!lifecycles.has(id) && r.ok && r.snapshot?.sessionId === id) { install(r.snapshot); if (readOnlyWindow) { writingShell.closePanels(); viewerStatus('已切换文档。'); } }
    else { failedSession = id; navigationError = 'switch-failed:' + (lifecycleCode(id) || r.code || 'invalid-snapshot'); }
  } catch { if (epoch === switchEpoch) navigationError = 'switch-failed:ipc-failed'; }
  finally {
    if (epoch === switchEpoch) {
      loading = false; switching = false; pendingSession = null;
      byId('documents').value = selected || '';
      if (controller) render(controller.state()); else { writingShell.sync(); recentView.sync(); show(); }
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
  // Only a matched, authoritative user-close refusal can release its pending fence.
  if (state === 'open') {
    lifecycles.delete(sessionId);
    if (selected === sessionId) navigationError = '';
    if (controller) render(controller.state());
    return;
  }
  lifecycles.set(sessionId, state);
  if (pendingSession === sessionId) {
    ++switchEpoch; loading = false; switching = false; pendingSession = null;
    failedSession = sessionId;
  }
  if (failedSession === sessionId) navigationError = 'switch-failed:' + lifecycleCode(sessionId);
  else if (selected === sessionId) navigationError = state === 'invalidated' ? 'session-invalidated' : state;
  if (controller) render(controller.state()); else { writingShell.sync(); recentView.sync(); show(); }
});
async function finishDocumentClose(id) {
  const options = [...byId('documents').options], index = options.findIndex(o => o.value === id);
  const next = options[index + 1] || options[index - 1];
  // Called only after the matched main-owned close receipt. Release presentation
  // caches; preload/main lifecycle fences and persisted recovery records remain.
  const copyId=controller?.state().confirmed.confirmedCopy?.copyId;
  draftView.release(id);testCopyView.release(id);originalSaveView.release(id);linkedFileView.release(id);copyActionsView.release(copyId);
  options[index]?.remove(); drafts.delete(id);
  controller?.dispose(); controller = null; selected = null;
  editor?.destroy(); editor = null; byId('editor').replaceChildren();
  findView.reset(); writingShell.closePanels();
  compositionView = null; copyPanelOpen = false; copyMessage = ''; ++copyEpoch;
  navigationError = ''; failedSession = null; pendingSession = null;
  for (const name of ['document-info', 'edit-copy', 'create-test-copy', 'temporary-notice', 'writing-status',
    'linked-file-card', 'original-save-status', 'save-original', 'copy-summary-compact', 'copy-operation-alert', 'confirmed-copy-actions', 'composition-warning',
    'composition-status', 'composition-copy-panel', 'input-pressure-panel', 'recovery-panel']) byId(name).hidden = true;
  for (const name of ['source', 'recovery', 'viewer-status', 'test-copy-result', 'test-copy-summary', 'test-copy-operation',
    'linked-file-path','linked-file-status','linked-file-checked','original-save-receipt', 'draft-backup-status', 'copy-action-status', 'input-pressure-source', 'save-version-list']) byId(name).textContent = '';
  document.body.dataset.documentState = 'empty'; document.title = 'Markdown'; byId('empty-state').hidden = false;
  for (const name of ['open-file', 'empty-open', 'new-temporary', 'documents']) byId(name).disabled = false;
  loading = false; inputPressure.sync(); nameView.sync(); formatView.sync();tableView.sync(); linkView.sync();imageView.sync(); findView.sync(); copyActionsView.render(); writingShell.sync(); recentView.sync();
  if (next) {
    byId('documents').value = next.value; await load();
    if (controller) { byId('document-info').hidden = false; byId('empty-state').hidden = true; document.body.dataset.documentState = 'open'; }
  } else byId('empty-new').focus();
  void draftView.refresh(); void recentView.refresh();
}
function viewerStatus(message, notice = false) {
  const node=byId('viewer-status');
  if(node.textContent!==message)node.textContent=message; // Avoid re-announcing unchanged status on every render.
  byId('viewer-status').toggleAttribute('data-notice', notice);
}
async function openDocument(temporary = false, editingCopy = false, draftId = null, confirmedCopy = null, recentId = null, nativeRequestId = null, linkedRequest = null) {
  const state = controller?.state();
  if (!readOnlyWindow || loading || state?.pending || state?.composing || state?.compositionInvalid || state?.historyPending) return;
  const original = state?.confirmed;
  if (confirmedCopy && (activeInvalid() || state.locked || state.compositionInvalid || state.recoveryRecords.length
      || state.source !== original.source || confirmedCopy.sessionId !== selected
      || confirmedCopy.expectedRevision !== original.revision || confirmedCopy.copyId !== original.confirmedCopy?.copyId)) return;
  if(linkedRequest&&(activeInvalid()||state.locked||state.recoveryRecords.length||state.source!==original.source
      ||linkedRequest.sessionId!==selected||linkedRequest.expectedRevision!==original.revision||!original.linkedFile))return;
  if (editingCopy && (!original?.readOnly || !original.editCopyEnabled || activeInvalid() || state.locked
      || state.recoveryRecords.length || state.source !== original.source)) return;
  loading = true; const epoch = ++switchEpoch;
  for (const id of ['open-file', 'empty-open', 'new-temporary']) byId(id).disabled = true;
  if (controller) render(controller.state()); else writingShell.sync(); recentView.sync();
  viewerStatus(editingCopy ? '正在创建独立编辑副本…' : temporary ? '正在新建草稿…' : '正在打开…');
  let candidate = null, reused = false;
  try {
    const r = await (linkedRequest ? api.openLinkedFile(linkedRequest) : nativeRequestId ? api.openNativeFile(nativeRequestId) : recentId ? api.openRecent(recentId) : confirmedCopy ? api.openConfirmedCopy(confirmedCopy) : draftId ? api.restoreDraft(draftId) : editingCopy ? api.editCopy({ sessionId: original.sessionId, expectedRevision: original.revision, expectedSha256: original.editCopySha256 }) : temporary ? api.newTemporary() : api.openFile());
    if (epoch !== switchEpoch) return;
    if ((confirmedCopy && lifecycles.has(confirmedCopy.sessionId)) || (linkedRequest && lifecycles.has(linkedRequest.sessionId))) throw Error('Source session invalidated');
    if (!r.ok) {
      const messages = { 'recent-file-unavailable': '最近文档已变化、被移动或无法验证，请通过「打开…」重新选择。', 'recents-unavailable': '最近列表暂不可用，请通过「打开…」选择文件。', 'confirmed-copy-unavailable': '文件已移动、被修改或无法验证，请通过「打开…」重新选择检查。', 'copy-action-unknown': '打开结果尚未确认，请勿重复操作；当前草稿与文件回执仍保留。', 'draft-already-open': '该草稿已在当前窗口打开。', 'draft-unreadable': '草稿无法验证，原记录已保留。', 'draft-read-failed': '草稿读取失败，原记录已保留。', 'draft-unavailable': '草稿已不可用。', 'open-cancelled': '已取消打开。', 'file-unavailable': '所选文件已不存在。',
        'read-failed': '无法读取所选文件。', 'unsupported-encoding': '目前仅支持 UTF-8 Markdown。',
        'unsupported-size': '文件超过 2 MiB 上限，无法打开。', 'parse-failed': '内容无法解析或超过约 52 万字符的正文上限。',
        'unsupported-path': '请选择一个受支持的 .md 文件。', 'unsupported-file': '请选择普通文件，符号链接暂不支持。',
        'edit-copy-outcome-unknown': '副本创建结果未知，请勿重复创建；原文件仍为只读。',
        'temporary-create-failed': '无法创建独立编辑副本。', 'copy-session-invalidated': '原文会话已不可用。',
        'source-hash-mismatch': '无法验证已打开的内容。', 'stale-revision': '已打开的文档修订发生变化。',
        'external-change': '文件在读取期间发生变化。', 'session-limit': '当前窗口已达到八份文档上限。' };
      viewerStatus((messages[r.code] || '无法打开所选文件。') + ' 当前文档未改变。', true);
      return r;
    }
    if(linkedRequest&&(r.sessionId!==linkedRequest.sessionId||r.requestRevision!==linkedRequest.expectedRevision))throw Error('Linked request mismatch');
    reused = r.reused === true;
    candidate = r.snapshot;
    if (!candidate || (nativeRequestId && r.requestId !== nativeRequestId) || (recentId && r.recentId !== recentId) || (temporary ? candidate.temporary !== true || candidate.readOnly !== false : candidate.readOnly !== true || typeof candidate.location !== 'string')
        || lifecycles.has(candidate.sessionId) || typeof candidate.label !== 'string') throw Error('Invalid read-only snapshot');
    if (editingCopy && (candidate.sessionId === original.sessionId || candidate.source !== original.source || candidate.bom !== original.bom
        || candidate.revision !== 0 || candidate.canUndo || candidate.canRedo || lifecycles.has(original.sessionId))) throw Error('Invalid copy snapshot');
    const projection = projectSource(candidate.source);
    const schema = editor?.schema || getSchema([...documentEditorExtensions()]);
    schema.nodeFromJSON(projection.doc).check(); // Validate before changing active identity/content.
    const previous = controller?.state().confirmed;
    navigationError = '';
    const option = document.createElement('option'); option.value = candidate.sessionId; option.textContent = candidate.label;
    if (![...byId('documents').options].some(o => o.value === candidate.sessionId)) byId('documents').append(option);
    install(candidate);
    byId('document-info').hidden = false; writingShell.closePanels();
    byId('empty-state').hidden = true; document.body.dataset.documentState = 'open'; window.scrollTo(0, 0);
    if (!linkedRequest && !nativeRequestId && !editingCopy && previous?.readOnly && previous.sessionId !== candidate.sessionId) {
      try {
        const closed = await api.close({ sessionId: previous.sessionId, expectedRevision: previous.revision });
        if (closed.ok) [...byId('documents').options].find(o => o.value === previous.sessionId)?.remove();
      }
      catch { /* Old authority cannot grant write access; main will revoke it on close. */ }
    }
    viewerStatus(linkedRequest?'已单独打开磁盘版，原文与草稿保留。需要编辑此版本，请创建编辑副本。':draftId ? (r.recovered?.warning ? '已恢复较早的可验证草稿，较新记录无法确认且已保留。撤销历史从此处重新开始；当前为独立草稿。' : '已恢复本地草稿为独立副本。撤销历史从此处重新开始；当前为独立草稿。') : editingCopy ? '已创建独立编辑副本，原文件保持只读；磁盘上的后续变化不会自动导入。' : temporary ? '草稿已就绪。另存新文件后才能在 Finder 中找到。' : '原文只读；点击「编辑副本」开始修改。');
    return { ok: true };
  } catch {
    if (!reused && candidate && selected !== candidate.sessionId) {
      try { await api.close({ sessionId: candidate.sessionId, expectedRevision: candidate.revision }); } catch { /* main revokes on window close */ }
    }
    viewerStatus('Unable to display the selected file. 当前文档未改变。', true);
    return { ok: false, code: 'display-failed' };
  } finally {
    loading = false; for (const id of ['open-file', 'empty-open', 'new-temporary']) byId(id).disabled = false;
    if (controller) render(controller.state()); else writingShell.sync(); recentView.sync();
    void recentView.refresh();
    if (temporary && candidate?.sessionId === selected && !activeInvalid()) editor?.view.focus();
  }
}
const openReadOnly = () => { if (!linkView.isOpen() && !imageView.isOpen() && !nameView.isOpen() && !sourceView.isOpen()) return openDocument(false); };
byId('new-temporary').onclick = () => openDocument(true);
byId('edit-copy').onclick = () => openDocument(true, true);
byId('open-file').onclick = openReadOnly;
byId('empty-open').onclick = openReadOnly;
api.onOpenRequest(openReadOnly);
const saveCurrent=()=>{
  if(sourceView.isOpen()){byId('apply-source').click();return;}
  if(document.querySelector('dialog[open]'))return;
  if(controller?.state().confirmed.originalSave?.available)void originalSaveView.save();
  else byId('create-test-copy').click();
};
api.onSaveRequest(saveCurrent);
window.addEventListener('keydown', event => {
  if(readOnlyWindow&&(event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='s'&&!sourceView.isOpen()){event.preventDefault();saveCurrent();return;}
  if (readOnlyWindow && (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'o') {
    event.preventDefault(); void openReadOnly();
  }
});
api.onReady(data => {
  readOnlyWindow = data?.readOnlyWindow === true;
  if (readOnlyWindow) draftView.configure(data);
  if (readOnlyWindow) {
    document.body.dataset.documentViewer = 'true'; document.body.dataset.documentState = 'empty';
    byId('document-header').hidden = false; byId('empty-state').hidden = false; byId('empty-open').disabled = false;
    byId('writing-actions').hidden = false; byId('new-temporary').disabled = false;
    byId('documents').hidden = true; byId('documents').setAttribute('aria-label', '切换已打开文档');
    writingShell.configure(); findView.configure(); closeView.configure(); recentView.configure(data);
    byId('open-file').disabled = false; document.title = 'Markdown';
    nativeOpenView.configure(); accessibility.configure();
  } else byId('connect').disabled = false;
});
