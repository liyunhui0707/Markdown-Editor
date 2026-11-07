// Presentation only: session authority, edits, composition and writes stay in their controllers.
export function createWritingShell({ byId, context, refreshDrafts = () => {}, reading = null, sourceView = null }) {
  let enabled = false, previousSession = null;
  const metadata = new Map(), rows = new Map();
  const blocked = () => {
    const { loading, state: s } = context();
    return loading || s?.pending > 0 || s?.historyPending || s?.composing || s?.compositionInvalid;
  };
  const media = globalThis.matchMedia?.('(max-width: 760px)');
  function sidebar(open) {
    byId('writing-app').dataset.sidebar = open ? 'open' : 'closed';
    byId('toggle-session-sidebar').setAttribute('aria-expanded', String(open));
    byId('sidebar-scrim').hidden = !open || !media?.matches;
    byId('document-sidebar').inert = !open;
  }
  for (const id of ['toggle-session-sidebar', 'close-session-sidebar', 'sidebar-scrim']) {
    byId(id).onpointerdown = event => { if (blocked()) event.preventDefault(); };
    byId(id).onclick = () => {
      if (!enabled || blocked()) return;
      const open = id === 'toggle-session-sidebar' && byId('writing-app').dataset.sidebar !== 'open';
      sidebar(open);
      if (!open) byId('toggle-session-sidebar').focus();
      else byId('session-filter').focus();
    };
  }
  byId('document-sidebar').addEventListener('pointerdown', event => { if (blocked()) event.preventDefault(); });
  byId('session-filter').oninput = () => syncNavigation();
  byId('empty-new').onclick = () => { if (enabled && !blocked()) byId('new-temporary').click(); };
  const panels = [['show-drafts', 'draft-dialog'], ['show-details', 'document-details-dialog']];
  for (const [buttonId, dialogId] of panels) {
    const button = byId(buttonId), dialog = byId(dialogId);
    button.onpointerdown = event => { if (blocked()) event.preventDefault(); };
    button.onclick = () => {
      if (!enabled || blocked() || button.disabled) return;
      byId('document-info').open = false;
      dialog.showModal(); button.setAttribute('aria-expanded', 'true');
      if (buttonId === 'show-drafts') void refreshDrafts();
    };
    const close = () => {
      if (dialogId === 'draft-dialog') {
        if (byId('cancel-draft-management').disabled) return;
        byId('cancel-draft-management').click();
      }
      dialog.close();
    };
    byId('close-' + dialogId).onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => button.setAttribute('aria-expanded', 'false'));
  }
  const confirmation = byId('copy-confirm-dialog');
  confirmation.addEventListener('cancel', event => {
    event.preventDefault();
    if (!byId('cancel-test-copy').disabled) byId('cancel-test-copy').click();
  });
  const info = byId('document-info'), doc = info.ownerDocument, title = info.querySelector('summary');
  const canDismissTitle = () => enabled && info.open && !blocked() && !doc.querySelector('dialog[open]');
  doc.addEventListener('pointerdown', event => {
    // Close only this disclosure; let the destination receive its normal click/focus.
    if (!event.defaultPrevented && canDismissTitle() && !info.contains(event.target)) info.open = false;
  }, true);
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || !canDismissTitle()) return;
    const returnFocus = info.contains(doc.activeElement);
    event.preventDefault(); event.stopPropagation(); info.open = false;
    if (returnFocus) title.focus();
  }, true);
  title.addEventListener('pointerdown', event => { if (blocked()) event.preventDefault(); });
  title.addEventListener('click', event => { if (blocked()) event.preventDefault(); });
  function closePanels() {
    reading?.close(); sourceView?.close();
    for (const [, id] of panels) if (byId(id).open) byId(id).close();
    byId('document-info').open = false;
    if (media?.matches) sidebar(false);
  }
  function navigate(id) {
    const select = byId('documents'), c = context();
    // Resolve against the existing main-approved session list at click time.
    // Highlight/content change only when the existing load path confirms identity.
    if (!enabled || blocked() || select.disabled || c.unavailable?.(id)
        || ![...select.options].some(o => o.value === id) || id === c.state?.confirmed?.sessionId) return;
    select.value = id;
    return select.onchange?.();
  }
  function syncNavigation() {
    if (!enabled) return;
    const c = context(), confirmed = c.state?.confirmed, select = byId('documents');
    if (confirmed) metadata.set(confirmed.sessionId, { temporary: confirmed.temporary, readOnly: confirmed.readOnly });
    const options = [...select.options], ids = new Set(options.map(o => o.value));
    for (const [id, row] of rows) if (!ids.has(id)) { row.button.remove(); rows.delete(id); metadata.delete(id); }
    const list = byId('session-list'), doc = list.ownerDocument;
    for (const option of options) {
      const id = option.value;
      if (!rows.has(id)) {
        const button = doc.createElement('button'), label = doc.createElement('strong'), detail = doc.createElement('small');
        button.type = 'button'; button.className = 'session-row'; button.dataset.sessionId = id;
        button.append(label, detail); button.onclick = () => navigate(id);
        button.onpointerdown = event => { if (blocked()) event.preventDefault(); };
        rows.set(id, { button, label, detail }); list.append(button);
      }
      const { button, label, detail } = rows.get(id), m = metadata.get(id);
      label.textContent = option.textContent; button.title = option.textContent;
      button.setAttribute('aria-current', String(id === confirmed?.sessionId));
      button.disabled = !!(blocked() || select.disabled || c.unavailable?.(id));
      detail.textContent = c.unavailable?.(id) ? '会话已不可用' : c.pendingSession === id ? '正在切换…'
        : m?.temporary ? '独立草稿' : m?.readOnly ? '原文只读' : '已打开文档';
      button.hidden = !option.textContent.toLocaleLowerCase().includes(byId('session-filter').value.trim().toLocaleLowerCase());
    }
    byId('session-count').textContent = String(options.length);
    byId('session-empty').hidden = [...rows.values()].some(r => !r.button.hidden);
    byId('session-empty').textContent = options.length ? '没有匹配的已打开文档。' : '打开一份文档，或从新的草稿开始。';
  }
  function sync() {
    if (!enabled) return;
    const s = context().state, current = s?.confirmed;
    byId('writing-status').hidden = !s;
    byId('show-drafts').disabled = !!blocked() || byId('draft-recovery-panel').hidden;
    byId('show-details').disabled = !!blocked() || !s;
    byId('empty-new').disabled = !!blocked() || byId('new-temporary').disabled;
    for (const id of ['toggle-session-sidebar', 'close-session-sidebar', 'session-filter', 'sidebar-scrim']) byId(id).disabled = !!blocked();
    byId('reading-mode').hidden = !current?.readOnly;
    byId('document-statistics').textContent = current ? current.source.replace(/\s/gu, '').length.toLocaleString() + ' 字符 · Markdown' : 'Markdown';
    if (current?.sessionId !== previousSession) {
      byId('document-scroll').scrollTop = 0;
      byId('session-filter').value = '';
      previousSession = current?.sessionId;
    }
    byId('details-document-name').textContent = current?.label || '未打开文档';
    byId('details-document-kind').textContent = current?.temporary ? (current.originalSave?.lastConfirmed ? (current.dirty?'文件草稿 · 修改未保存':'文件草稿 · 正文已保存') : '独立草稿') : '原文件 · 只读';
    byId('details-document-location').textContent = current?.temporary ? (current.originalSave?.filePath || '独立草稿，尚未关联文件。') : current?.location || '';
    byId('details-document-revision').textContent = String(current?.revision ?? '—');
    byId('details-document-count').textContent = current ? current.source.replace(/\s/gu, '').length.toLocaleString() : '—';
    byId('details-backup-card').hidden = !current?.temporary;
    syncNavigation(); reading?.sync(); sourceView?.sync();
    if (!byId('test-copy-confirmation').hidden) {
      if (!confirmation.open) { closePanels(); confirmation.showModal(); }
    } else if (confirmation.open) confirmation.close();
  }
  return { sync, closePanels, configure() {
    enabled = true;
    byId('writing-app').hidden = false;
    byId('sidebar-actions').append(byId('new-temporary'), byId('open-file'));
    byId('sidebar-bottom').append(byId('show-drafts'));
    byId('header-start').append(byId('document-info'));
    byId('header-end').prepend(byId('writing-actions'));
    byId('writing-workspace').prepend(byId('document-header'));
    byId('writing-toolbar').prepend(byId('format-toolbar'));
    byId('document-scroll').append(byId('native-open-panel'), byId('original-save-status'), byId('copy-summary-compact'), byId('confirmed-copy-actions'), byId('copy-operation-alert'), byId('viewer-status'), byId('input-alerts'), byId('empty-state'), byId('editor'));
    byId('writing-footer').prepend(byId('writing-status'));
    byId('document-switcher').append(byId('documents'));
    byId('draft-dialog-content').append(byId('draft-recovery-panel'));
    byId('draft-recovery-panel').open = true;
    byId('details-writing-help').append(byId('temporary-notice'));
    byId('details-backup-content').append(byId('draft-backup-status'));
    byId('document-details-content').append(byId('original-save-receipt'),byId('test-copy-panel'));
    confirmation.append(byId('test-copy-confirmation'));
    for (const id of ['composition-status', 'composition-warning', 'composition-copy-panel', 'input-pressure-panel', 'recovery-panel']) byId('input-alerts').append(byId(id));
    sidebar(!media?.matches);
    media?.addEventListener('change', () => sidebar(!media.matches));
    reading?.configure(); sourceView?.configure(); sync();
  } };
}
