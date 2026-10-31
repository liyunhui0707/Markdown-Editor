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
      ? 'Create a new .md in a supported local APFS folder directly under your home folder. Existing files are never overwritten. Current writing remains Not saved; later edits do not update the new file. Cloud/sync folders are not supported.'
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
    byId('test-copy-operation').textContent = confirmed
      ? `Latest operation: copy confirmed for revision ${receipt.revision}.`
      : receipt && (receipt.code || receipt.state !== 'not-created')
        ? `Latest operation: Copy not confirmed: ${receipt.code || receipt.state}. State: ${receipt.state || 'not-created'}; created: ${String(receipt.created ?? 'unknown')}. No automatic retry or cleanup.\n${receipt.filePath || ''}` : '';
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
