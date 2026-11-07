// Draft metadata only; main verifies backup before confirming the new name.
export function createNameView({ api, byId, context, busy, rerender, changed }) {
  const button = byId('rename-draft'), dialog = byId('name-dialog'), input = byId('draft-name-input'), error = byId('draft-name-error');
  let captured = null, inFlight = false, composing = false;
  const blocked = c => !c.state?.confirmed.temporary || c.loading || c.invalid || c.nativeComposing
    || c.state.pending || c.state.composing || c.state.compositionInvalid || c.state.historyPending
    || c.state.locked || c.state.recoveryRecords.length || c.state.source !== c.state.confirmed.source;
  function sync() {
    const c = context(); button.hidden = !c.state?.confirmed.temporary; button.disabled = inFlight || !!blocked(c);
    byId('name-apply').disabled = inFlight || composing; byId('name-cancel').disabled = inFlight;
    input.disabled = inFlight;
  }
  function open() {
    const c = context(); if (blocked(c) || dialog.open) return;
    captured = { controller: c.controller, snapshot: c.state.confirmed };
    input.value = captured.snapshot.label; error.textContent = ''; composing = false;
    byId('document-info').open = false; dialog.showModal(); input.focus(); input.select(); sync();
  }
  function close() {
    if (inFlight || composing) return;
    dialog.close(); captured = null; context().editor?.view.focus();
  }
  async function commit() {
    if (!captured || inFlight || composing) return;
    const c = context(), before = captured.snapshot;
    if (blocked(c) || c.controller !== captured.controller || c.state.confirmed.revision !== before.revision || c.state.confirmed.label !== before.label) {
      error.textContent = '文档状态已变化，请取消后重新命名。当前输入保留。'; return;
    }
    const requestedName = input.value, label = requestedName.trim().replace(/\.md$/i, '').trim();
    if (!label) { error.textContent = '请输入草稿名称。'; return; }
    inFlight = true; busy(true); rerender(); sync();
    try {
      const result = await api.renameDraft({ sessionId: before.sessionId, expectedRevision: before.revision, expectedLabel: before.label, label: requestedName });
      if (context().controller !== c.controller || context().invalid) { error.textContent = '会话已变化，命名结果未确认。'; return; }
      c.controller.refresh(result);
      if (result.ok && c.controller.state().confirmed.label === label && !c.controller.state().locked) {
        changed(before.sessionId, label); dialog.close(); captured = null;
      } else error.textContent = result.code === 'invalid-draft-name'
        ? '名称不能以点开头，也不能含路径分隔符、冒号或控制字符；请使用较短名称。'
        : '名称未确认，当前名称和正文仍保留。请检查草稿备份状态，不自动重试。';
    } catch { c.controller.refresh(null); error.textContent = '命名结果未知，当前正文保留，请勿重复操作。'; }
    finally { inFlight = false; busy(false); rerender(); sync(); if (!dialog.open) c.editor?.view.focus(); }
  }
  button.onpointerdown = event => { if (blocked(context())) event.preventDefault(); }; button.onclick = open;
  byId('name-form').addEventListener('submit', event => { event.preventDefault(); void commit(); });
  byId('name-cancel').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  input.addEventListener('compositionstart', () => { composing = true; sync(); });
  input.addEventListener('compositionend', () => { composing = false; sync(); });
  input.addEventListener('input', () => { error.textContent = ''; });
  return { sync, isOpen: () => dialog.open };
}
