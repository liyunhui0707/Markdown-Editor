import { TextSelection } from '@tiptap/pm/state';

// Chromium's cross-block DOM replacement can reparse adjacent opaque blocks.
// Capture only a matching native text selection before mutation; dispatch through
// the same controller/source-map gate. No clipboard, IME or Markdown parsing here.
export function replaceParagraphRangeInput(view, event, { state, blocked = false, report = () => {} }) {
  const keyDelete = ['Backspace','Delete'].includes(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  if ((!keyDelete && !['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType))
      || event.defaultPrevented || !event.cancelable || event.isComposing || view.composing
      || event.keyCode === 229
      || !view.editable || !view.hasFocus() || !state || blocked || state.confirmed.readOnly
      || state.locked || state.historyPending || state.composing || state.compositionInvalid) return false;
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return false;
  const inItem = selection.$from.depth > 1 && selection.$from.node(selection.$from.depth - 1).type.name === 'listItem';
  const crossItems = inItem && selection.$from.depth === selection.$to.depth
    && selection.$from.node(selection.$from.depth-2) === selection.$to.node(selection.$to.depth-2)
    && selection.$from.node(selection.$from.depth-1) !== selection.$to.node(selection.$to.depth-1)
    && selection.$to.parent.type.name === 'paragraph';
  if (keyDelete && !crossItems) return false;
  if (selection.$from.sameParent(selection.$to)
      && (selection.$from.parent.type.name !== 'paragraph'
        || (!inItem && !selection.$from.parent.content.content.some(n => n.marks.some(m => ['bold','italic','code'].includes(m.type.name)))))) return false;
  if (event.inputType === 'insertText' && (typeof event.data !== 'string' || !event.data)) return false;
  const rejectTarget = () => {
    event.preventDefault();
    report('未应用修改：输入范围与当前选区不一致。请重新选择可编辑文字；当前内容未改变。',true);
    return true;
  };
  let matched = false;
  try {
    const dom = view.dom.ownerDocument.getSelection();
    if (!dom || dom.rangeCount !== 1 || dom.isCollapsed
        || !view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return false;
    const a = view.posAtDOM(dom.anchorNode, dom.anchorOffset), b = view.posAtDOM(dom.focusNode, dom.focusOffset);
    if (Math.min(a, b) !== selection.from || Math.max(a, b) !== selection.to) return false;
    matched = true;
    // An input method/browser may target something different from the selection.
    const targets = event.getTargetRanges?.() || [];
    if (targets.length > 1 || (targets.length === 1
        && (view.posAtDOM(targets[0].startContainer, targets[0].startOffset) !== selection.from
          || view.posAtDOM(targets[0].endContainer, targets[0].endOffset) !== selection.to))) return rejectTarget();
  } catch { return matched ? rejectTarget() : false; }
  event.preventDefault();
  // PM deleteSelection may expand a whole-list selection into a paragraph. Keep
  // this operation exactly inside the selected item text, with one surviving item.
  const tr = crossItems && event.inputType !== 'insertText'
    ? view.state.tr.delete(selection.from,selection.to).scrollIntoView()
    : view.state.tr.insertText(event.inputType === 'insertText' ? event.data : '').scrollIntoView();
  view.dispatch(tr); // Rejected ranges still produce the controller's normal refusal.
  return true;
}
