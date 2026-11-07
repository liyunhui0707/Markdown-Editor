const messages = {
  'session-limit': '已达到八份文档上限，请关闭一份后再打开。',
  'unsupported-path': '请选择普通 .md 文件。',
  'unsupported-file': '符号链接、硬链接和非普通文件暂不支持。',
  'unsupported-size': '文件超过当前大小限制。',
  'parse-failed': '内容超过当前预览限制。',
  'unsupported-encoding': '目前仅支持 UTF-8 Markdown。',
  'file-unavailable': '文件已不存在。',
  'read-failed': '无法读取文件，请检查访问权限。',
  'native-file-changed': '磁盘文件已变化，已打开的原文和草稿均保留。请通过「打开…」重新选择以读取新版。',
  'ipc-outcome-unknown': '打开结果尚未确认，请检查侧栏；不要重复操作。',
};
export function createNativeOpenView({ api, byId, canOpen, open }) {
  let enabled = false, running = false, manual = false, requests = [], overflow = 0, message = '', refreshEpoch = 0;
  const panel = byId('native-open-panel'), status = byId('native-open-status');
  function sync() {
    if (!enabled) return;
    panel.hidden = !requests.length && !overflow && !message;
    status.textContent = [message, requests.length ? `来自 Finder：${requests[0].label}（待打开 ${requests.length} 份）。${canOpen() ? '' : '当前输入或操作完成后可继续打开。'}` : '',
      overflow ? `有 ${overflow} 个请求超过队列容量，请稍后从 Finder 重新打开。` : ''].filter(Boolean).join(' ');
    byId('native-open-next').hidden = !requests.length;
    byId('native-open-skip').hidden = !requests.length;
    byId('native-open-next').disabled = running || !canOpen();
    byId('native-open-skip').disabled = running;
  }
  async function refresh(auto = false) {
    if (!enabled) return;
    const epoch = ++refreshEpoch;
    try {
      const r = await api.listNativeOpens();
      if (epoch !== refreshEpoch || !r.ok) return;
      requests = r.requests; overflow = r.overflow;
      sync();
      if (auto && !manual && !running && requests.length) {
        if (canOpen()) void next(); else { manual = true; sync(); }
      }
    } catch { message = 'Finder 打开请求暂不可用，当前文档仍保留。'; manual = true; sync(); }
  }
  async function next() {
    if (running || !canOpen() || !requests.length) return;
    running = true; const entry = requests[0]; message = ''; sync();
    let result;
    try { result = await open(entry.id); }
    catch { result = { ok: false, code: 'ipc-outcome-unknown' }; }
    running = false;
    manual = !result?.ok;
    if (!result?.ok) message = `${entry.label}：${messages[result?.code] || '未打开，当前文档保留。'}`;
    await refresh(!manual);
  }
  byId('native-open-next').onclick = next;
  byId('native-open-skip').onclick = async () => {
    if (running || !requests.length) return;
    running = true; sync();
    try { await api.dismissNativeOpen(requests[0].id); }
    catch { message = '跳过结果未确认，请保留当前文档并检查待打开列表。'; }
    finally { running = false; manual = true; await refresh(); }
  };
  api.onNativeOpenRequest(() => { if (!running) void refresh(true); });
  // Finishing an IME/modal never forces a document switch; a deferred request
  // remains explicit and can be opened or skipped without discarding writing.
  document.addEventListener('close', () => queueMicrotask(sync), true);
  document.addEventListener('compositionend', () => queueMicrotask(sync), true);
  return { sync, configure() { enabled = true; void refresh(true); } };
}
