// Navigation only. IDs come from main; existing open/recovery paths own sessions.
export function createRecentView({ api, byId, context, open, restore }) {
  let openForWriting=false;let enabled = false, draftsEnabled = false, busy = false, refreshing = false, sequence = 0;
  const dialog = byId('recent-dialog');
  const blocked = () => {
    const c = context(), s = c.state;
    return busy || refreshing || c.loading || c.invalid || s?.pending || s?.historyPending
      || s?.composing || s?.compositionInvalid || s?.locked || s?.recoveryRecords?.length;
  };
  function sync() {
    for (const id of ['show-recents', 'refresh-recents', 'clear-recents', 'welcome-drafts']) byId(id).disabled = !enabled || !!blocked() || (id === 'welcome-drafts' && !draftsEnabled);
    for (const id of ['welcome-recent-list', 'recent-list', 'welcome-draft-list'])
      for (const button of byId(id).querySelectorAll('button')) button.disabled = !!blocked() || button.dataset.unavailable === 'true';
  }
  function close() { dialog.close(); byId('show-recents').setAttribute('aria-expanded', 'false'); }
  async function act(fn) {
    if (blocked()) return;
    busy = true; sync(); close();
    try { await fn(); } finally { busy = false; await refresh(); }
  }
  function row(parent, label, detail, action, unavailable = false) {
    const button = document.createElement('button'), title = document.createElement('strong'), subtitle = document.createElement('small');
    button.type = 'button'; button.className = 'resume-row'; button.title = detail;
    title.textContent = label; subtitle.textContent = detail; button.append(title, subtitle);
    button.dataset.unavailable = String(unavailable); button.onclick = () => act(action);
    button.onpointerdown = e => { if (blocked()) e.preventDefault(); };
    parent.append(button); return button;
  }
  async function refresh() {
    if (!enabled || busy) return;
    const serial = ++sequence; refreshing = true; sync();
    try {
      const [recent, drafts] = await Promise.all([api.listRecents(), draftsEnabled ? api.listDrafts() : null]);
      if (serial !== sequence) return;
      for (const id of ['welcome-recent-list', 'recent-list', 'welcome-draft-list']) byId(id).replaceChildren();
      const entries = recent.ok ? recent.entries : [];
      for (const [id, limit] of [['welcome-recent-list', 6], ['recent-list', 12]]) {
        const panel = byId(id);
        for (const e of entries.slice(0, limit)) {
          const button = row(panel, e.label, e.location, () => open(e.id)); button.dataset.recentId = e.id;
        }
      }
      const status = recent.ok ? (entries.length ? (openForWriting?'点击后重新验证文件并开始写作；当前文档保留。':'点击后以只读方式重新验证并打开。') : '尚无最近文档。通过「打开…」选择一份 Markdown 开始。')
        : '最近列表暂不可用，已有记录保留。仍可通过「打开…」选择文件。';
      byId('welcome-recent-status').textContent = status; byId('recent-status').textContent = status;
      const available = drafts?.ok ? drafts.drafts : [];
      for (const d of available.slice(0, 3)) {
        const detail = d.active ? '已在当前窗口打开' : d.warning ? '较新备份未确认 · 可恢复已验证正文' : d.recoverable ? '本地草稿 · ' + new Date(d.time).toLocaleString() : '备份需要检查';
        const button = row(byId('welcome-draft-list'), d.label, detail, () => restore(d.id), d.active || !d.recoverable); button.dataset.draftId = d.id;
      }
      byId('welcome-draft-status').textContent = !draftsEnabled ? '本地草稿不可用。' : !drafts?.ok ? '草稿列表暂不可用，请在「草稿」中查看详情。' : available.length ? '恢复为独立草稿，原文件保持不变。' : '暂无待恢复草稿。';
    } catch {
      if (serial !== sequence) return;
      for (const id of ['welcome-recent-list', 'recent-list', 'welcome-draft-list']) byId(id).replaceChildren();
      byId('welcome-recent-status').textContent = byId('recent-status').textContent = '列表读取失败，请稍后刷新。当前文档保持不变。';
      byId('welcome-draft-status').textContent = '草稿读取失败，请在「草稿」中查看。';
    } finally { if (serial === sequence) { refreshing = false; sync(); } }
  }
  byId('show-recents').onclick = () => {
    if (!enabled || blocked()) return;
    dialog.showModal(); byId('show-recents').setAttribute('aria-expanded', 'true'); void refresh();
  };
  byId('show-recents').onpointerdown = e => { if (blocked()) e.preventDefault(); };
  byId('close-recent-dialog').onclick = close;
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  byId('refresh-recents').onclick = refresh;
  byId('welcome-drafts').onclick = () => { if (!blocked()) byId('show-drafts').click(); };
  byId('clear-recents').onclick = async () => {
    if (blocked()) return;
    busy = true; sync();
    let ok = false;
    try { ok = (await api.clearRecents()).ok === true; }
    catch { /* No retry for an unconfirmed catalog operation. */ }
    finally { busy = false; await refresh(); }
    if (!ok) byId('recent-status').textContent = '清空结果未确认，记录保留，不自动重试。Markdown 文件未改变。';
  };
  return { sync, refresh, configure(data) { openForWriting=data.openForWriting===true;enabled = true; draftsEnabled = data.draftsEnabled === true; void refresh(); } };
}
