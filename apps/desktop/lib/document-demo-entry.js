import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Plugin } from '@tiptap/pm/state';
import { projectSource, mapTextEdit } from './document-source-map.mjs';

const api = window.documentDemo, byId = id => document.getElementById(id);
let current = null, editor = null, loading = false, pending = false, prepared = null, selected = null;
function show(code) {
  byId('status').textContent = JSON.stringify({ code, revision: current?.revision, dirty: current?.dirty, saveState: current?.saveState });
}
function busy(value) {
  pending = value;
  for (const id of ['documents', 'reload', 'check', 'save']) byId(id).disabled = value;
}
function apply(snapshot, code) {
  if (!snapshot || snapshot.sessionId !== selected) return;
  current = snapshot; loading = true;
  const doc = projectSource(snapshot.source).doc;
  if (!editor) {
    const gate = Extension.create({ name: 'verifiedSourceRange', addProseMirrorPlugins() {
      return [new Plugin({ filterTransaction(tr) {
        if (loading || !tr.docChanged) return true;
        if (pending || tr.steps.length !== 1) { show(pending ? 'edit-pending' : 'unsafe-source-range'); return false; }
        const step = tr.steps[0];
        const textOnly = step.slice && step.slice.openStart === 0 && step.slice.openEnd === 0
          && [...step.slice.content.content].every(n => n.isText);
        if (step.toJSON().stepType !== 'replace' || !textOnly) { show('unsafe-source-range'); return false; }
        const insert = step.slice.content.textBetween(0, step.slice.content.size, '', '');
        const mapped = mapTextEdit(current.source, { from: step.from, to: step.to, insert });
        if (!mapped.ok || !tr.doc.type.schema.nodeFromJSON(mapped.projection.doc).eq(tr.doc)) {
          show('unsafe-source-range'); return false;
        }
        prepared = { from: step.from, to: step.to, insert }; return true;
      } })];
    } });
    editor = new Editor({ element: byId('editor'), content: doc, enableInputRules: false, enablePasteRules: false,
      extensions: [StarterKit.configure({ undoRedo: false, trailingNode: false }), gate],
      editorProps: { handleDOMEvents: {
        paste: (_view, event) => { event.preventDefault(); show('unsupported-paste'); return true; },
        drop: (_view, event) => { event.preventDefault(); show('unsupported-drop'); return true; },
      } }, // Before ProseMirror's default clipboard/HTML parsing, not handlePaste.
      onUpdate: async () => {
        if (loading || !prepared) return;
        const id = selected, change = prepared; prepared = null; busy(true);
        try {
          const reply = await api.edit({ sessionId: id, expectedRevision: current.revision, ...change });
          if (selected === id) apply(reply.snapshot || current, reply.code || 'memory-edited');
        } catch { apply(current, 'ipc-failed'); }
        finally { busy(false); }
      } });
  } else {
    const cursor = editor.state.selection.from;
    editor.commands.setContent(doc, { emitUpdate: false, errorOnInvalidContent: true });
    editor.commands.setTextSelection(Math.min(cursor, editor.state.doc.content.size - 1));
  }
  loading = false; byId('source').textContent = snapshot.source; show(code || 'opened');
}
async function load() {
  const id = byId('documents').value; selected = id; busy(true);
  try { const r = await api.snapshot({ sessionId: id }); if (r.ok && selected === id) apply(r.snapshot); else show(r.code); }
  catch { show('ipc-failed'); } finally { busy(false); }
}
byId('connect').onclick = async () => {
  const r = await api.list(); if (!r.ok) { show(r.code); return; }
  byId('documents').replaceChildren(...r.sessions.map(s => { const o = document.createElement('option'); o.value = s.sessionId; o.textContent = s.label; return o; }));
  byId('connect').disabled = true; await load();
};
byId('documents').onchange = load; byId('reload').onclick = load;
for (const operation of ['check', 'save']) byId(operation).onclick = async () => {
  if (!current || pending) return; busy(true);
  try {
    const r = await api[operation]({ sessionId: selected, ...(operation === 'save' ? { expectedRevision: current.revision } : {}) });
    apply(r.snapshot || current, r.code || r.status || 'checked');
  } catch { show('ipc-failed'); } finally { busy(false); }
};
api.onReady(() => { byId('connect').disabled = false; });
