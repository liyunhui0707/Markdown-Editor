import { TextSelection } from '@tiptap/pm/state';
import { mapFormatEdit } from './document-format-edit.mjs';

// Synchronous optimistic typing, queued through the same main-owned revision
// and history path as toolbar commands. Never serialize the editor to Markdown.
export function applyBlockShortcut(view, event, context) {
  const {controller,loading,invalid}=context, s=controller?.state();
  if(event.key!==' '||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey
      ||event.isComposing||event.keyCode===229||view.composing||!view.editable
      ||!s||s.confirmed.readOnly||s.composing||s.compositionInvalid||s.locked
      ||s.historyPending||s.recoveryRecords.length||loading||invalid) return false;
  const {from,to,$from,empty}=view.state.selection;
  if(!empty||$from.depth!==1||$from.parent.type.name!=='paragraph') return false;
  const command={action:'block-shortcut',from,to},mapped=mapFormatEdit(s.source,command);
  if(!mapped.ok) return false;
  const doc=view.state.schema.nodeFromJSON(mapped.projection.doc);
  const tr=view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content);
  tr.setSelection(TextSelection.create(tr.doc,mapped.selection.from,mapped.selection.to));
  tr.setStoredMarks(null).setMeta('document-block-shortcut',command);
  event.preventDefault();view.dispatch(tr.scrollIntoView());return true;
}
