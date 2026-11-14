'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function supportedOpenPath(file) {
  return typeof file === 'string' && file.length <= 4096 && !file.includes('\0')
    && path.isAbsolute(file) && /\.md$/i.test(file)
    && !path.basename(file).startsWith('.env.') && !file.split(path.sep).includes('secrets');
}

// OS events grant read intent; opening never writes back. Main may bind an
// isolated writing copy, with explicit Save consent and existing native checks. Paths never come back through renderer IPC.
// The bounded queue also captures events delivered before app/renderer readiness.
function createNativeOpenQueue() {
  const entries = []; let overflow = 0, notify = () => {};
  const list = () => ({ ok: true, requests: entries.map(({ id, label }) => ({ id, label })), overflow });
  function changed() { try { notify(); } catch { /* Pending intent survives a missing renderer. */ } }
  return {
    list,
    subscribe(fn) { notify = fn; },
    enqueue(file) {
      const valid = supportedOpenPath(file), target = valid ? path.normalize(file) : null;
      if (target && entries.some(e => e.file === target)) return;
      if (entries.length >= 16) { overflow = Math.min(overflow + 1, 999); changed(); return; }
      entries.push({ id: randomUUID(), file: target, label: valid ? path.basename(target) : '不支持的文件' });
      changed();
    },
    consume(id, open) {
      const entry = entries.find(e => e.id === id);
      if (!entry) return { ok: false, code: 'native-request-unavailable', requestId: id };
      let result;
      try { result = entry.file ? open(entry.file) : { ok: false, code: 'unsupported-path' }; }
      catch { result = { ok: false, code: 'open-failed' }; }
      if (!['session-limit', 'open-busy'].includes(result.code)) entries.splice(entries.indexOf(entry), 1);
      changed();
      return { ...result, requestId: id };
    },
    dismiss(id) {
      const index = entries.findIndex(e => e.id === id);
      if (index < 0) return { ok: false, code: 'native-request-unavailable' };
      entries.splice(index, 1); changed(); return { ok: true };
    },
  };
}
module.exports = { createNativeOpenQueue, supportedOpenPath };
