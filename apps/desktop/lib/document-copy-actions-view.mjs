// Read/display actions for a main-owned confirmed receipt; no renderer paths.
export function createCopyActionsView({ api, byId, context, open, busy, rerender }) {
  const messages = new Map();
  function current() {
    const c = context(), s = c.controller?.state(), receipt = s?.confirmed.confirmedCopy;
    const available = s?.confirmed.temporary && receipt?.ok === true && receipt.state === 'created-confirmed'
      && typeof receipt.copyId === 'string';
    const blocked = !available || c.loading || c.invalid || s.locked || s.pending || s.historyPending
      || s.composing || s.compositionInvalid || s.recoveryRecords.length || s.source !== s.confirmed.source;
    return { c, s, receipt, available, blocked };
  }
  function render() {
    const { available, blocked, receipt } = current();
    byId('confirmed-copy-actions').hidden = !available;
    for (const id of ['open-confirmed-copy', 'reveal-confirmed-copy']) byId(id).disabled = !!blocked;
    byId('copy-action-status').textContent = available ? messages.get(receipt.copyId) || '' : '';
  }
  for (const id of ['open-confirmed-copy', 'reveal-confirmed-copy']) {
    byId(id).onpointerdown = event => { if (current().blocked) event.preventDefault(); };
    byId(id).onclick = async () => {
      const { c, s, receipt, blocked } = current(); if (blocked) return;
      const request = { sessionId: c.selected, expectedRevision: s.confirmed.revision, copyId: receipt.copyId };
      if (id === 'open-confirmed-copy') { await open(request); return; }
      busy(true); rerender();
      try {
        const result = await api.revealConfirmedCopy(request);
        messages.set(receipt.copyId, result?.ok === true && result.copyId === receipt.copyId
          ? '已请求在 Finder 中显示该文件。'
          : result?.code === 'confirmed-copy-unavailable'
            ? '文件已移动、被修改或无法验证，未在 Finder 中显示；当前草稿仍保留。'
            : '未能确认 Finder 定位结果，当前草稿与文件回执仍保留。');
      } catch { messages.set(receipt.copyId, '未能确认 Finder 定位结果，当前草稿与文件回执仍保留。'); }
      finally { busy(false); rerender(); }
    };
  }
  return { render };
}
