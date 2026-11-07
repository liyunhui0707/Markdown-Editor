import { TextSelection } from '@tiptap/pm/state';

// A native line-start move may precede PM's selectionchange acknowledgement.
// Reconcile only a collapsed caret at the start of the SAME plain paragraph,
// whose DOM text still matches the confirmed PM document. No content mutation.
export function syncNativeBackspaceSelection(view,event,options) {return syncCaret(view,event,options,false);}
// List/table structural keys must observe an already moved native caret before
// splitting/lifting, including a click from another paragraph. The target must
// be the unchanged list/cell paragraph owned by this PM view; no content mutation.
export function syncNativeListSelection(view,event,options) {return syncCaret(view,event,options,true);}
function syncCaret(view, event, { state, blocked = false }, listOnly) {
  if ((listOnly?!['Enter','Tab','Backspace'].includes(event.key):event.key!=='Backspace') || event.defaultPrevented || event.metaKey || event.altKey || event.ctrlKey
      || event.isComposing || event.keyCode === 229 || view.composing || !view.editable || !view.hasFocus()
      || !state || blocked || state.confirmed.readOnly || state.locked || state.pending || state.historyPending
      || state.composing || state.compositionInvalid || state.source !== state.confirmed.source) return false;
  let next;
  try {
    const dom = view.dom.ownerDocument.getSelection(), current = view.state.selection;
    if (!dom || dom.rangeCount !== 1 || !dom.isCollapsed || !current.empty
        || !view.dom.contains(dom.anchorNode) || dom.anchorNode !== dom.focusNode || dom.anchorOffset !== dom.focusOffset) return false;
    const at = view.posAtDOM(dom.anchorNode, dom.anchorOffset), pos = view.state.doc.resolve(at);
    if (pos.parent.type.name !== 'paragraph' || (!listOnly&&pos.parentOffset!==0)
        || (listOnly&&(pos.depth<3||!['listItem','tableCell','tableHeader'].includes(pos.node(pos.depth-1).type.name)))
        || (!listOnly&&current.$from.start()!==pos.start()) || current.from === at) return false;
    const element = dom.anchorNode.nodeType === 3 ? dom.anchorNode.parentElement : dom.anchorNode;
    const paragraph = element.closest('p');
    if (!paragraph || view.nodeDOM(pos.before()) !== paragraph || paragraph.textContent !== pos.parent.textContent) return false;
    next = TextSelection.create(view.state.doc, at);
  } catch { return false; } // Detached/unmappable DOM leaves existing PM safety handling in charge.
  view.dispatch(view.state.tr.setSelection(next));
  return true;
}
