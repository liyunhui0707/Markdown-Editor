'use strict';
// Close one main-owned session. This grants no file-write or discard authority.
async function closeDocumentSession({ id, session: s, revision, authorized, service, backups, confirm, invalidate, snapshot }) {
  const reply = result => authorized()
    ? { ...result, ...(!result.ok && snapshot ? { snapshot: snapshot() } : {}), sessionId: id, requestRevision: revision, closed: result.ok === true }
    : { ok: false, code: 'close-outcome-unknown' };
  const fail = code => reply({ ok: false, code });
  if (s.closing) return fail('close-in-progress');
  if (s.copying) return fail('copy-in-progress');
  if (!Number.isSafeInteger(revision) || revision < 0) return fail('invalid-revision');
  if (s.document.revision !== revision) return fail('stale-revision');
  if (!s.readOnly && !s.temporary) return fail('close-unavailable');
  s.closing = true;
  try {
    const state = service.getSaveState(s.document), copy = service.getCopyState(s.document);
    if (!state.ok || state.durabilityUncertain || state.replacementUnverified
        || (copy.created !== false && !copy.ok)) return fail('unresolved-save-state');
    let unchangedFile=false;
    if(s.fileDocument&&s.document.revision===0&&!s.document.dirty&&backups?.status(s.document)?.state==='file-unmodified'){
      service.inspectLinkedFile(s.document);unchangedFile=service.getLinkedFile(s.document)?.checked?.state==='unchanged';
    }
    if (s.temporary&&!unchangedFile) {
      if (typeof confirm !== 'function') return fail('close-unavailable');
      const accepted = await confirm(s.win, s.label);
      if (!authorized()) return { ok: false, code: 'close-outcome-unknown' };
      if (accepted !== true) return fail('close-cancelled');
      if (s.document.revision !== revision) return fail('stale-revision');
      if ((s.document.text.length || s.document.revision) && !backups?.verifyForClose(s.document)) return fail('close-backup-unverified');
    }
    const result = service.close(s.document);
    if (!result.ok) return fail(result.code);
    const receipt = reply({ ok: true });
    invalidate(id, s); // Authority is revoked before the successful reply reaches preload.
    return receipt;
  } catch { return fail('close-failed'); }
  finally { s.closing = false; }
}
module.exports = { closeDocumentSession };
