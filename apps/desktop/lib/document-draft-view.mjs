// Backup receipts are separate from export receipts and editor/history state.
export function createDraftView({ api, byId, context, restore }) {
  const receipts = new Map(); let enabled = false;
  function remember(sessionId, backup) {
    if (!backup || !Number.isSafeInteger(backup.sequence)) return;
    const old = receipts.get(sessionId);
    if (!old || backup.sequence >= old.sequence) receipts.set(sessionId, backup);
  }
  function render(s) {
    const node = byId('draft-backup-status'); node.hidden = !enabled || !s?.confirmed.temporary;
    if (node.hidden) return;
    remember(s.confirmed.sessionId, s.confirmed.draftBackup);
    const r = receipts.get(s.confirmed.sessionId), last = r?.revision == null ? '尚无已确认备份' : `最后已备份修订 ${r.revision}`;
    const unsettled = s.pending || s.historyPending || s.composing || s.compositionInvalid || s.recoveryRecords?.length || s.locked || s.source !== s.confirmed.source || context().invalid;
    node.textContent = r?.state === 'backed-up' && r.revision === s.confirmed.revision
      ? `本地草稿已备份（修订 ${r.revision}）。这不是 Markdown 文件保存，当前仍为 Not saved。`
      : r?.state === 'backup-pending' ? `正在备份已确认正文；${last}。`
      : ['backup-failed', 'draft-unverified'].includes(r?.state) ? `草稿备份未确认：${r.code}；${last}。当前文字保留，请另存新文件。`
      : '尚未备份。输入内容后会备份已确认正文。';
    if (unsettled) node.textContent += ' 当前输入或操作尚未确认，不包含在备份保证中。';
    node.dataset.tone = ['backup-failed', 'draft-unverified'].includes(r?.state) ? 'error' : '';
  }
  async function refresh() {
    if (!enabled) return;
    const panel = byId('draft-recovery-list'), status = byId('draft-recovery-status');
    try {
      const result = await api.listDrafts();
      if (!result.ok) { status.textContent = `无法读取本地草稿：${result.code}。已有记录保留。`; return; }
      panel.replaceChildren();
      status.textContent = result.drafts.length ? `发现 ${result.drafts.length} 份草稿。仅恢复最近可验证的已确认正文；不恢复旧 Undo 历史或保存授权。` : '没有可恢复的本地草稿。';
      for (const d of result.drafts) {
        const row = document.createElement('p'), button = document.createElement('button'), label = document.createElement('span');
        label.textContent = `${d.label}${d.recoverable ? ' · 修订 ' + d.revision : ''}${d.warning ? ' · 较新记录损坏或未确认，可能只能恢复较早内容' : ''} `;
        button.textContent = d.active ? '已在当前窗口打开' : '恢复副本'; button.disabled = d.active || !d.recoverable;
        button.onclick = async () => {
          const c = context(), s = c.state;
          if (c.loading || s?.pending || s?.historyPending || s?.composing) { status.textContent = '请先完成当前输入或操作，再恢复草稿。'; return; }
          button.disabled = true; await restore(d.id); await refresh();
        };
        row.append(label, button); panel.append(row);
      }
    } catch { status.textContent = '草稿读取通信失败，当前内容与磁盘记录保留。'; }
  }
  api.onDraftStatus(({ sessionId, backup }) => { remember(sessionId, backup); render(context().state); });
  byId('refresh-drafts').onclick = refresh;
  return { render, configure(data) {
    enabled = data.draftsEnabled === true;
    byId('draft-recovery-panel').hidden = !(enabled || data.draftError);
    if (data.draftError) byId('draft-recovery-status').textContent = '本地草稿不可用，当前写作仍仅在内存中。请另存新文件。';
    if (enabled) {
      byId('temporary-notice').textContent = 'Not saved — 已确认正文会备份到本机应用私有目录。请查看下方备份状态；尚未确认的输入、Undo 历史与输入恢复记录不保证跨退出保留。另存新文件才会生成 Markdown 文件，后续编辑不会自动更新它。支持最多 32 段纯文本粘贴。';
      void refresh();
    }
  } };
}
