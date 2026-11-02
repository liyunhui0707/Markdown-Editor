// Read only text/plain from the user-initiated paste event. Never parse clipboard HTML.
// The existing PM filter/controller/IPC remain the edit and history authority.
export function pastePlainText(view, event, { state, blocked = false, report }) {
  event.preventDefault();
  const reject = message => { report(message, true); return true; };
  if (!state || blocked || !view.editable || state.confirmed.readOnly || state.locked
      || state.historyPending || state.pending || state.source !== state.confirmed.source) {
    return reject('未粘贴：文档只读、正在处理操作或尚未同步。当前文字未改变。');
  }
  if (view.composing || state.composing || state.compositionInvalid) {
    return reject('未粘贴：请先完成或取消输入法组合。当前文字未改变。');
  }
  let text;
  try {
    const data = event.clipboardData;
    if (!data || data.files?.length || !Array.from(data.types || []).includes('text/plain')) {
      return reject('未粘贴：剪贴板没有可用的纯文本。图片和文件暂不支持。');
    }
    text = data.getData('text/plain');
  } catch { return reject('未粘贴：无法读取剪贴板文字。当前文字未改变。'); }
  if (typeof text !== 'string' || text.length > 4096 || /[\x00-\x1f\x7f\u2028\u2029]/u.test(text)) {
    return reject('未粘贴：当前只支持不超过 4096 个 UTF-16 单位的单行纯文本；换行、制表符和控制字符暂不支持。没有截断内容。');
  }
  if (!text) return true; // An empty clipboard must not delete the current selection.
  const tr = view.state.tr.insertText(text).scrollIntoView();
  view.dispatch(tr); // No direct model mutation or bypass of verifiedSourceRange.
  if (!view.state.doc.eq(tr.doc)) {
    return reject('未粘贴：所选范围或文字涉及暂不支持的 Markdown 结构。请在同一普通文本范围内粘贴；当前文字未改变。');
  }
  return true;
}
