import { TextSelection } from '@tiptap/pm/state';

// Chromium's cross-block DOM replacement can reparse adjacent opaque blocks.
// Capture only a matching native text selection before mutation; dispatch through
// the same controller/source-map gate. No clipboard, IME or Markdown parsing here.
export function replaceParagraphRangeInput(view, event, { state, blocked = false }) {
  if (!['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType)
      || event.defaultPrevented || !event.cancelable || event.isComposing || view.composing
      || !view.editable || !view.hasFocus() || !state || blocked || state.confirmed.readOnly
      || state.locked || state.historyPending || state.composing || state.compositionInvalid) return false;
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return false;
  if (selection.$from.sameParent(selection.$to)
      && (selection.$from.parent.type.name !== 'paragraph'
        || !selection.$from.parent.content.content.some(n => n.marks.some(m => m.type.name === 'bold')))) return false;
  if (event.inputType === 'insertText' && (typeof event.data !== 'string' || !event.data)) return false;
  try {
    const dom = view.dom.ownerDocument.getSelection();
    if (!dom || dom.rangeCount !== 1 || dom.isCollapsed
        || !view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return false;
    const a = view.posAtDOM(dom.anchorNode, dom.anchorOffset), b = view.posAtDOM(dom.focusNode, dom.focusOffset);
    if (Math.min(a, b) !== selection.from || Math.max(a, b) !== selection.to) return false;
    // An input method/browser may target something different from the selection.
    const targets = event.getTargetRanges?.() || [];
    if (targets.length > 1 || (targets.length === 1
        && (view.posAtDOM(targets[0].startContainer, targets[0].startOffset) !== selection.from
          || view.posAtDOM(targets[0].endContainer, targets[0].endOffset) !== selection.to))) return false;
  } catch { return false; }
  event.preventDefault();
  const tr = view.state.tr.insertText(event.inputType === 'insertText' ? event.data : '').scrollIntoView();
  view.dispatch(tr); // Rejected ranges still produce the controller's normal refusal.
  return true;
}
