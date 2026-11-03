// UI for the existing main-owned isolated-copy capability, not a save service.
export function copyRefusal(s, { loading = false, invalid = false } = {}) {
  if (!s || !s.confirmed.temporary || s.confirmed.readOnly || !s.confirmed.copyEnabled) return 'test-copy-unavailable';
  if (invalid || s.locked || s.confirmed.blocked) return 'document-locked';
  if (s.composing || s.compositionInvalid) return 'composition-active';
  if (loading || s.pending || s.historyPending) return 'document-busy';
  if (s.source !== s.confirmed.source || s.recoveryRecords.length) return 'unconfirmed-input';
  if (!/^[a-f0-9]{64}$/.test(s.confirmed.copySha256 || '')) return 'unverified-source';
  const receipt = s.confirmed.copyState;
  if (receipt && !receipt.ok && receipt.created !== false) return 'unresolved-copy-state';
  return null;
}

function operationMessage(receipt) {
  if (!receipt || (!receipt.code && receipt.state === 'not-created')) return '';
  if (receipt.ok && receipt.state === 'created-confirmed') return `本次已创建新文件（修订 ${receipt.revision}）。当前编辑副本仍为 Not saved。`;
  let text;
  if (receipt.created === false) {
    const reason = receipt.code === 'unsupported-acl' ? '此目录带有当前不支持的额外权限（ACL），请改选下载或主文件夹直属的其他普通本地文件夹，仍需通过权限检查。'
      : receipt.code === 'target-exists' ? '同名目标已存在，没有覆盖它；请使用新文件名。'
      : receipt.code === 'create-cancelled' ? '操作已取消。'
      : '目标位置或创建操作未通过检查，请查看原因并选择受支持的位置。';
    text = `未创建文件：${reason}文字仍保留在当前窗口。`;
  } else {
    text = ({ 'created-partial': '文件已创建，但内容可能不完整',
      'created-unverified': '文件已创建，但完整性尚未确认',
      'durability-uncertain': '文件已写入，但持久性尚未确认' })[receipt.state]
      || '创建结果未知，文件可能已经存在';
    text += '。不要覆盖或重复创建；请保留当前窗口和下方路径，检查结果。当前文字仍保留。';
  }
  return `${text}\n原因：${receipt.code || receipt.state}；状态：${receipt.state || 'create-outcome-unknown'}${receipt.filePath ? `\n${receipt.filePath}` : ''}`;
}

export function createTestCopyView({ api, byId, context, busy, rerender, focus }) {
  const receipts = new Map(), confirmedReceipts = new Map(), unknown = new Set();
  let confirmation = null;
  let persistent = false;
  const refusal = c => unknown.has(c.selected) ? 'copy-outcome-unknown' : copyRefusal(c.controller?.state(), c);
  function render(s) {
    const c = context(), enabled = s.confirmed.copyEnabled && s.confirmed.temporary && !s.confirmed.readOnly;
    persistent = enabled && s.confirmed.persistentCopyEnabled === true;
    byId('create-test-copy').textContent = persistent ? 'Save as new file…' : '创建测试副本';
    byId('confirm-test-copy').textContent = persistent ? 'Choose location…' : 'Create new test copy';
    byId('test-copy-description').textContent = persistent
      ? '选择主文件夹直属的普通本地 APFS 文件夹，例如下载或你自行准备的 Markdown Writing（仍需通过权限检查）。主文件夹本身、桌面、文稿、资源库、隐藏与同步目录不受支持；仅支持防止删除目录自身的默认权限（ACL），其他额外权限仍会被拒绝。文件夹须归你所有且不能由其他用户写入。只用新文件名，已有文件绝不覆盖；应用不会修改文件夹权限。'
      : 'Disposable test copy only. Files may be cleaned by the system; do not use for important or long-term documents.';
    byId('create-test-copy').hidden = !enabled;
    byId('test-copy-panel').hidden = !enabled;
    if (!enabled) return;
    const reason = refusal(c);
    byId('create-test-copy').disabled = !!reason;
    byId('test-copy-reason').textContent = confirmation ? 'Review the revision below, then confirm or cancel.' : reason ? `Copy unavailable: ${reason}. Current writing is retained.` : '';
    byId('test-copy-confirmation').hidden = !confirmation || confirmation.sessionId !== c.selected;
    const receipt = receipts.get(c.selected) || s.confirmed.copyState;
    const confirmed = receipt?.ok === true && receipt.state === 'created-confirmed';
    // Display history only: never use an earlier success to clear the latest refusal/unknown state.
    if (confirmed) confirmedReceipts.set(c.selected, { ...receipt });
    const last = confirmedReceipts.get(c.selected);
    byId('test-copy-result').textContent = last
      ? `Last confirmed copy — ${persistent ? 'New Markdown file' : 'Test copy'} created: revision ${last.revision}. Current temporary document is still Not saved; later edits do not update this copy.\n${last.filePath}\nSHA-256: ${last.sha256}` : '';
    byId('test-copy-summary').textContent = last
      ? `已创建新文件：${last.filePath}\n已确认修订 ${last.revision}。${s.source !== s.confirmed.source || s.confirmed.revision !== last.revision ? '后续修改尚未导出。' : '仅代表该修订的新文件副本。'}当前编辑副本仍为 Not saved。`
      : '';
    byId('test-copy-receipt').hidden = !last;
    byId('test-copy-operation').textContent = operationMessage(receipt);
    byId('test-copy-operation').dataset.tone = confirmed ? 'success'
      : receipt?.code === 'create-cancelled' ? 'neutral' : receipt?.ok === false ? 'error' : 'neutral';
  }
  function finish() {
    confirmation = null; busy(false); rerender();
    const c = context(); if (!c.invalid && !c.controller?.state().locked) focus();
  }
  byId('create-test-copy').onpointerdown = event => {
    if (refusal(context())) event.preventDefault(); // Never blur an active composition into apparent readiness.
  };
  byId('create-test-copy').onclick = () => {
    const c = context(); if (refusal(c)) return;
    const s = c.controller.state().confirmed;
    confirmation = { persistent, controller: c.controller, sessionId: c.selected, revision: s.revision, source: s.source, hash: s.copySha256 };
    busy(true); // Freeze edits, history and switching through confirmation and response.
    byId('test-copy-confirm-revision').textContent = `Create a new ${persistent ? 'Markdown file' : 'test copy'} of confirmed revision ${s.revision}?`;
    byId('confirm-test-copy').disabled = false; byId('cancel-test-copy').disabled = false; rerender();
  };
  byId('cancel-test-copy').onclick = () => { if (confirmation) finish(); }; // No IPC or source mutation.
  byId('confirm-test-copy').onclick = async () => {
    const q = confirmation, c = context(); if (!q) return;
    const s = c.controller?.state();
    if (c.controller !== q.controller || c.selected !== q.sessionId || copyRefusal(s, { invalid: c.invalid })
      || s.confirmed.revision !== q.revision || s.confirmed.source !== q.source || s.confirmed.copySha256 !== q.hash) { finish(); return; }
    byId('confirm-test-copy').disabled = true; byId('cancel-test-copy').disabled = true;
    try {
      const r = await (q.persistent ? api.createPersistentCopy : api.createTestCopy)({ sessionId: q.sessionId, expectedRevision: q.revision, expectedSha256: q.hash });
      const now = context();
      const valid = now.controller === q.controller && now.selected === q.sessionId && !now.invalid
        && r?.snapshot?.sessionId === q.sessionId && r.snapshot.revision === q.revision && r.snapshot.source === q.source;
      if (!valid || (r.ok && (r.copy?.state !== 'created-confirmed' || r.copy.revision !== q.revision || r.copy.sha256 !== q.hash))) {
        unknown.add(q.sessionId);
        receipts.set(q.sessionId, { ...r?.copy, ok: false, code: r?.code || 'copy-outcome-unknown', state: 'create-outcome-unknown', created: null });
      } else {
        receipts.set(q.sessionId, r.ok ? r.copy : { ...r.copy, ok: false, code: r.code || r.copy?.code });
        q.controller.refresh(r); // Same source/revision only; no baseline or history reset.
      }
    } catch {
      unknown.add(q.sessionId); receipts.set(q.sessionId, { ok: false, state: 'create-outcome-unknown', created: null, code: 'copy-outcome-unknown' });
    } finally { finish(); }
  };
  return { render };
}
