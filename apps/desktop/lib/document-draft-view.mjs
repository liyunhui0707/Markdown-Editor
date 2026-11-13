// Backup receipts are separate from export receipts and editor/history state.
export function createDraftView({ api, byId, context, restore }) {
  const receipts = new Map(); let enabled = false, busy = false, refreshSequence = 0, selection = null;
  function remember(sessionId, backup) {
    if (!backup || !Number.isSafeInteger(backup.sequence)) return;
    const old = receipts.get(sessionId);
    if (!old || backup.sequence >= old.sequence) receipts.set(sessionId, backup);
  }
  function render(s) {
    const node = byId('draft-backup-status'); node.hidden = !enabled || !s?.confirmed.temporary;
    const summary = byId('backup-summary'); summary.hidden = node.hidden;
    if (node.hidden) {
      summary.hidden = !s?.confirmed.temporary;
      summary.textContent = '本地备份不可用 · 请另存新文件保留内容'; summary.dataset.tone = 'error';
      return;
    }
    remember(s.confirmed.sessionId, s.confirmed.draftBackup);
    const r = receipts.get(s.confirmed.sessionId), last = r?.revision == null ? '尚无已确认备份' : `最后已备份修订 ${r.revision}`;
    const unsettled = s.pending || s.historyPending || s.composing || s.compositionInvalid || s.recoveryRecords?.length || s.locked || s.source !== s.confirmed.source || context().invalid;
    node.textContent = r?.state === 'backed-up' && r.revision === s.confirmed.revision
      ? `本地草稿已备份（修订 ${r.revision}）。备份用于恢复草稿；另存新文件后才能在 Finder 中找到。`
      : r?.state === 'backup-pending' ? `正在备份已确认正文；${last}。`
      : ['backup-failed', 'draft-unverified'].includes(r?.state) ? `草稿备份未确认：${r.code}；${last}。当前文字保留，请另存新文件。`
      : '尚未备份。输入内容后会备份已确认正文。';
    if (r?.code === 'draft-capacity') node.textContent += ' 待恢复草稿已满，请归档不再使用的草稿；下次确认编辑时会再次尝试备份。';
    if (r?.code === 'draft-record-capacity') node.textContent += ' 本地记录已达上限；归档不释放磁盘记录，请先另存新文件。';
    if (unsettled) node.textContent += ' 当前输入或操作尚未确认，不包含在备份保证中。';
    node.dataset.tone = ['backup-failed', 'draft-unverified'].includes(r?.state) ? 'error' : '';
    summary.dataset.tone = node.dataset.tone;
    summary.textContent = node.dataset.tone === 'error' ? '本地备份未确认 · 请另存新文件，详情中可查看原因'
      : s.inputPaused ? '输入已暂停 · 未确认修改仅保留在当前窗口'
      : s.composing && !s.compositionInvalid ? '输入中…'
      : unsettled ? '正在确认修改…'
      : r?.state === 'backed-up' && r.revision === s.confirmed.revision ? '已备份'
      : r?.state === 'backup-pending' ? '正在备份…' : '尚未备份';
  }
  const blocked = () => {
    const c = context(), s = c.state;
    return c.loading || s?.pending || s?.historyPending || s?.composing;
  };
  function cancel() { selection = null; byId('draft-management-confirmation').hidden = true; }
  function choose(d, action) {
    if (busy || blocked()) { byId('draft-operation-status').textContent = '请先完成当前输入或操作。'; return; }
    selection = { draftId: d.id, action, expectedToken: d.manageToken };
    byId('draft-management-description').textContent = `${action === 'archive' ? '归档' : '放回'}“${d.label}”（${d.id.slice(0, 8)} · 修订 ${d.revision}）？`
      + (action === 'archive' ? '将移出待恢复列表，内容仍留在本机，可在“已归档”中放回。不会删除 Markdown 文件。' : '将重新占用一份待恢复草稿名额；不会打开文档或改写任何 Markdown 文件。');
    byId('confirm-draft-management').textContent = action === 'archive' ? '确认归档' : '确认放回';
    byId('draft-management-confirmation').hidden = false;
  }
  function addRows(panel, drafts, archived) {
    for (const d of drafts) {
      const row = document.createElement('p'), label = document.createElement('span'), meta = document.createElement('span');
      row.dataset.draftId = d.id; row.className = 'draft-card';
      label.className = 'draft-card-title'; label.textContent = d.label;
      const badge = document.createElement('span'), actions = document.createElement('span');
      badge.className = 'state-pill'; badge.dataset.tone = d.warning ? 'error' : 'neutral';
      badge.textContent = d.warning ? '需要检查' : d.active ? '正在使用' : archived ? '已归档' : d.recoverable ? '可恢复' : '无法恢复';
      actions.className = 'draft-actions';
      meta.className = 'draft-detail';
      meta.textContent = `${d.time ? new Date(d.time).toLocaleString() : '备份时间未知'} · ${d.id.slice(0, 8)}`
        + (Number.isSafeInteger(d.revision) ? ` · 修订 ${d.revision}` : '')
        + (d.warning ? ' · 较新记录损坏或未确认，或存在异常旧记录；保留原记录，暂停整理' : '')
        + (d.active ? ' · 使用中，关闭文档后可归档' : '');
      row.append(label, badge, meta);
      if (!archived) {
        const restoreButton = document.createElement('button');
        restoreButton.textContent = d.active ? '已在当前窗口打开' : '恢复副本'; restoreButton.disabled = d.active || !d.recoverable;
        restoreButton.onclick = async () => {
          if (busy || blocked()) { byId('draft-operation-status').textContent = '请先完成当前输入或操作，再恢复草稿。'; return; }
          busy = true; cancel(); restoreButton.disabled = true;
          try { await restore(d.id); } finally { busy = false; await refresh(); }
        };
        restoreButton.className = 'primary-action'; actions.append(restoreButton);
      }
      const manage = document.createElement('button'); manage.textContent = archived ? '放回待恢复列表' : '归档';
      manage.disabled = d.active || !d.manageToken;
      manage.onclick = () => choose(d, archived ? 'unarchive' : 'archive');
      actions.append(manage); row.append(actions); panel.append(row);
    }
  }
  async function refresh() {
    if (!enabled || busy) return;
    const sequence = ++refreshSequence, status = byId('draft-recovery-status');
    byId('draft-empty').hidden = true;
    status.textContent = '正在读取本地草稿…'; status.dataset.tone = 'neutral';
    try {
      const result = await api.listDrafts();
      if (sequence !== refreshSequence || busy) return;
      cancel();
      const panel = byId('draft-recovery-list'), archive = byId('draft-archive-list');
      panel.replaceChildren(); archive.replaceChildren();
      if (!result.ok) { status.dataset.tone = 'error'; status.textContent = `无法读取本地草稿：${result.code}。已有记录保留，暂停整理。`; return; }
      const c = result.capacity;
      byId('draft-empty').hidden = result.drafts.length > 0;
      status.textContent = `待恢复 ${result.drafts.length} / ${c?.limit ?? 32} 份，已归档 ${result.archived?.length ?? 0} 份。`
        + (c ? ` 本地记录 ${c.records} / ${c.maxRecords}。` : '')
        + (c?.records >= c?.maxRecords ? ' 记录已满，归档不能释放磁盘记录；请先另存新文件。' : c?.active >= c?.limit ? ' 待恢复名额已满，可归档不再使用的草稿。' : '')
        + ' 仅恢复已确认正文，不恢复旧 Undo 历史或保存授权。';
      addRows(panel, result.drafts, false); addRows(archive, result.archived || [], true);
      byId('draft-archive-empty').hidden = !!result.archived?.length;
    } catch {
      if (sequence !== refreshSequence) return;
      cancel(); byId('draft-recovery-list').replaceChildren(); byId('draft-archive-list').replaceChildren();
      byId('draft-empty').hidden = true; status.dataset.tone = 'error';
      status.textContent = '草稿读取通信失败，当前内容与磁盘记录保留，暂停整理。';
    }
  }
  byId('cancel-draft-management').onclick = () => { if (!busy) cancel(); };
  byId('confirm-draft-management').onclick = async () => {
    if (!selection || busy) return;
    const output = byId('draft-operation-status');
    if (blocked()) { output.textContent = '请先完成当前输入或操作。'; return; }
    const request = selection; busy = true; ++refreshSequence;
    output.dataset.tone = 'neutral'; output.textContent = '正在整理，请稍候…';
    for (const id of ['refresh-drafts', 'confirm-draft-management', 'cancel-draft-management', 'close-draft-dialog']) byId(id).disabled = true;
    try {
      const r = await api.manageDraft(request);
      output.dataset.tone = r.ok ? 'success' : 'error';
      output.textContent = r.ok ? (request.action === 'archive' ? '已归档，可在“已归档”中放回。' : '已放回待恢复列表。')
        : `草稿整理未确认：${r.code}。` + (r.state === 'draft-unverified' || ['draft-operation-unknown', 'ipc-outcome-unknown'].includes(r.code)
          ? '结果可能已发生变化，记录保留；请刷新核对，不自动重试。'
          : r.code === 'draft-capacity' ? '待恢复名额已满，请先归档其他闲置草稿。'
          : r.code === 'draft-record-capacity' ? '本地记录已满，归档不释放磁盘记录；请先另存新文件。' : '请刷新列表核对；当前写作保留。');
    } catch { output.dataset.tone = 'error'; output.textContent = '草稿整理通信中断，结果未知。记录保留，请刷新核对，不自动重试。'; }
    finally {
      busy = false; cancel();
      for (const id of ['refresh-drafts', 'confirm-draft-management', 'cancel-draft-management', 'close-draft-dialog']) byId(id).disabled = false;
      await refresh();
    }
  };
  api.onDraftStatus(({ sessionId, backup }) => {
    const c=context(); if(c.hasSession && !c.hasSession(sessionId)) return;
    remember(sessionId, backup); render(c.state);
  });
  byId('refresh-drafts').onclick = refresh;
  return { render, refresh, release(sessionId) { receipts.delete(sessionId); }, configure(data) {
    enabled = data.draftsEnabled === true;
    byId('draft-recovery-panel').hidden = !(enabled || data.draftError);
    if (data.draftError) byId('draft-recovery-status').textContent = '本地草稿不可用，当前写作仍仅在内存中。请另存新文件。';
    if (enabled) {
      byId('temporary-notice').textContent = '未存为文件 — 已确认正文会备份到本机应用私有目录。请查看备份状态；尚未确认的输入、Undo 历史与输入恢复记录不保证跨退出保留。另存新文件才会生成 Markdown 文件，后续编辑不会自动更新它。支持最多 32 段纯文本粘贴。';
      void refresh();
    }
  } };
}
