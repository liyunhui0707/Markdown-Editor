'use strict';
// Main-confirmed models only; no renderer body, path, save receipt or history input.
function createDraftBackups(store, notify = () => {}) {
  const entries = new Map();
  function status(document) {
    const e = entries.get(document); if (!e) return null;
    return { sequence: e.sequence, state: e.pending ? 'backup-pending' : e.result?.state || 'not-backed-up',
      revision: e.confirmed?.revision ?? null, code: e.result?.code || null };
  }
  function flush(document) {
    const e = entries.get(document); if (!e || !e.pending) return;
    clearTimeout(e.timer); e.timer = null; e.pending = false; e.sequence++;
    try {
      const result = store.save({ id: e.id, token: e.token, fingerprint: e.fingerprint, label: e.label, revision: document.revision, bytes: document.bytesForSave() });
      e.result = result;
      if (result.ok) { e.confirmed = result; e.token = result.token; e.fingerprint = result.fingerprint; }
      else e.stopped = result.state === 'draft-unverified' || ['draft-conflict', 'EEXIST'].includes(result.code);
    } catch { e.result = { state: 'backup-failed', code: 'draft-unavailable' }; }
    notify(document, status(document));
  }
  function changed(document) {
    const e = entries.get(document); if (!e || e.stopped) return;
    if (e.confirmed?.revision === document.revision) return;
    e.pending = true; e.sequence++;
    if (!e.timer) e.timer = setTimeout(() => flush(document), 800);
  }
  function attach(document, label, recovery) {
    const e = { id: recovery && !recovery.warning ? recovery.id : store.newId(),
      token: recovery && !recovery.warning ? recovery.token : null, fingerprint: recovery && !recovery.warning ? recovery.identity : null, label, sequence: 0, pending: false, timer: null };
    entries.set(document, e); if (document.text.length || recovery) changed(document);
  }
  function verifyForClose(document) {
    const e = entries.get(document); if (!e) return false;
    flush(document);
    if (e.pending || !e.result?.ok || e.confirmed?.revision !== document.revision) return false;
    try {
      const recovered = store.recover(e.id);
      if (recovered.ok && !recovered.warning && recovered.token === e.token
        && recovered.identity === e.fingerprint && recovered.revision === document.revision
        && recovered.bytes.equals(document.bytesForSave())) return true;
    } catch { /* Preserve the live document and every uncertain disk record. */ }
    e.result = { ok: false, state: 'draft-unverified', code: 'draft-verification-failed' };
    e.stopped = true; e.sequence++; notify(document, status(document));
    return false;
  }
  function release(document) { flush(document); entries.delete(document); }
  return { attach, changed, status, release, flush, verifyForClose,
    flushAll: () => { for (const doc of entries.keys()) flush(doc); },
    active: id => [...entries.values()].some(e => e.id === id) };
}
module.exports = { createDraftBackups };
