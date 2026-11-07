// Current-document action only. Main owns confirmation, backup verification and revocation.
export function createCloseView({ api, byId, context, busy, rerender, closed, report }) {
  let enabled = false, inFlight = false;
  const button = byId('close-current-document');
  function blocked() {
    const c = context(), s = c.controller?.state();
    return !enabled || inFlight || !s || c.loading || c.invalid || c.nativeComposing
      || s.pending || s.composing || s.compositionInvalid || s.historyPending || s.locked
      || s.recoveryRecords.length || s.source !== s.confirmed.source;
  }
  function sync() { button.hidden = !enabled || !context().controller; button.disabled = !!blocked(); }
  async function close() {
    if (blocked() || button.ownerDocument.querySelector('dialog[open]')) return;
    const c = context(), expected = c.controller.state().confirmed;
    inFlight = true; busy(true); rerender();
    try {
      const result = await api.closeDocument({ sessionId: expected.sessionId, expectedRevision: expected.revision });
      if (context().controller !== c.controller || context().selected !== expected.sessionId) return;
      if (result?.ok === true && result.closed === true && result.sessionId === expected.sessionId
          && result.requestRevision === expected.revision) await closed(expected.sessionId);
      else {
        // Backup receipts may have arrived while preload fenced this session.
        if (result?.closed === false && result.sessionId === expected.sessionId
            && result.requestRevision === expected.revision && result.snapshot && !context().invalid) c.controller.refresh(result);
        const messages = { 'close-cancelled': '已取消关闭，继续编辑。',
          'close-backup-unverified': '本地草稿尚未通过完整性验证，文档未关闭。请另存新文件保留内容。',
          'unresolved-save-state': '文件创建结果尚未确认，文档保持打开，请先检查现有文件。',
          'composition-active': '请先完成或取消当前输入，再关闭文档。' };
        report(messages[result?.code] || '未能确认关闭结果，当前内容仍保留；请勿刷新窗口。', result?.code !== 'close-cancelled');
      }
    } catch { report('未能确认关闭结果，当前内容仍保留；请勿刷新窗口。', true); }
    finally { inFlight = false; busy(false); rerender(); }
  }
  button.onpointerdown = event => { if (blocked()) event.preventDefault(); };
  button.onclick = close;
  api.onCloseRequest(() => { void close(); });
  return { sync, configure() { enabled = true; sync(); } };
}
