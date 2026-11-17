'use strict';
// Close one main-owned session. Only an explicit native Save choice invokes the
// existing main-owned writer; renderer closure supplies no path/discard authority.
async function closeDocumentSession({ id, session: s, revision, authorized, service, backups, confirm, save, invalidate, snapshot }) {
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
    const origin=service.getOriginalState?.(s.document);
    if((origin?.available||s.fileDocument)&&!origin?.stopped&&!s.document.dirty){
      service.inspectLinkedFile(s.document);unchangedFile=service.getLinkedFile(s.document)?.checked?.state==='unchanged';
    }
    const emptyDraft=!origin&&!s.fileDocument&&!s.document.revision&&!s.document.text.length;
    if (s.temporary&&!unchangedFile&&!emptyDraft) {
      if (typeof confirm !== 'function') return fail('close-unavailable');
      const accepted = await confirm(s.win, s.label);
      if (!authorized()) return { ok: false, code: 'close-outcome-unknown' };
      if (accepted !== true && !['save','keep-draft'].includes(accepted)) return fail('close-cancelled');
      if (s.document.revision !== revision) return fail('stale-revision');
      if(accepted==='save'){
        if(typeof save!=='function')return fail('close-save-unavailable');
        const saved=await save();
        if(!authorized())return {ok:false,code:'close-outcome-unknown'};
        if(!saved?.ok)return fail(saved?.code||'close-save-failed');
        if(s.document.revision!==revision)return fail('stale-revision');
      }
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
