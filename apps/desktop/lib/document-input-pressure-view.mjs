// Recovery evidence stays window-local. This view cannot submit an edit or save.
export function createInputPressureView({ byId, context, focus }) {
  let identity = null;
  const current = () => {
    const c = context(), s = c.state;
    return { c, s, record: s?.recoveryRecords.find(r => r.reason === 'edit-queue-full') };
  };
  function sync() {
    const { c, s, record } = current();
    const key = record ? `${record.sessionId}:${record.id}` : null;
    if (identity !== key) { identity = key; byId('input-pressure-ack').checked = false; }
    byId('input-pressure-panel').hidden = !record;
    for (const [id, text] of [['input-pressure-source', record?.source || ''], ['input-pressure-queued', record?.queuedSource || '']]) {
      const node = byId(id); if (node.textContent !== text) node.textContent = text;
    }
    if (!record) return;
    byId('input-pressure-status').textContent = (s.pending
      ? '正在确认暂停前的修改。'
      : '请核对已确认正文和保留的未提交修改。')
      + '输入过快，确认队列已满。触发暂停的那次修改已单独保留；暂停后的按键不会接收。未确认内容不会自动重试或备份，请勿关闭此窗口。';
    byId('input-pressure-resume').disabled = !byId('input-pressure-ack').checked
      || c.loading || c.invalid || s.pending > 0 || s.historyPending || s.composing
      || s.source !== s.confirmed.source || s.code === 'sync-unknown';
  }
  byId('input-pressure-ack').onchange = sync;
  byId('input-pressure-select').onclick = () => {
    if (!current().record) return;
    const node = byId('input-pressure-source'), doc = node.ownerDocument, range = doc.createRange();
    range.selectNodeContents(node); const selection = doc.defaultView.getSelection();
    selection.removeAllRanges(); selection.addRange(range); node.focus();
  };
  byId('input-pressure-resume').onclick = () => {
    sync(); const { c, record } = current();
    if (!record || byId('input-pressure-resume').disabled) return;
    if (c.controller.discardRecovery(record.id) && !c.controller.state().locked) focus();
  };
  return { sync };
}
