'use strict';
const { createHash } = require('node:crypto');
const { createDocumentModel } = require('./document-model');
const { createDocumentFileStore } = require('./document-file-store');
const { record, failure, revisionError } = require('./document-contract');

// A local main-process capability, NOT an arbitrary-path renderer IPC API.
// Future document opening must authorize paths before handing out session IDs.
function createDocumentService(options = {}) {
  // Trusted main-process construction only, never an IPC payload.
  if (!record(options, ['fs', 'unsafeExperimentalRoot', 'isolatedCreateRoot'])) throw TypeError('Invalid service construction options');
  const store = createDocumentFileStore(options);
  const sessions = new WeakMap();
  const unknown = () => failure('unknown-document');
  function getSaveState(document) {
    const s = sessions.get(document);
    // This is the stable persistence outcome, not an ephemeral progress flag.
    return s ? Object.freeze({ ok: true, state: s.state, committed: s.committed,
      durabilityUncertain: s.pending, replacementUnverified: s.unverified, lastCode: s.lastCode,
      dirty: document.dirty, revision: document.revision }) : unknown();
  }

  function open(filePath, options = {}) {
    if (!record(options, ['parse', 'maxBytes', 'syntheticTemporary'])
        || (options.syntheticTemporary !== undefined && typeof options.syntheticTemporary !== 'boolean')) return failure('invalid-options');
    const { parse } = options;
    try {
      if (options.syntheticTemporary) store.authorizeSynthetic(filePath);
      const snapshot = store.read(filePath, options.maxBytes);
      if (options.syntheticTemporary) store.authorizeSynthetic(filePath);
      const { document, acceptSaved } = createDocumentModel({ filePath, bytes: snapshot.bytes, identity: snapshot.identity });
      sessions.set(document, { snapshot, acceptSaved, saving: false, state: 'not-submitted', committed: false,
        pending: false, unverified: false, lastCode: null, syntheticTemporary: options.syntheticTemporary === true, copy: null });
      if (!document.encoding) return { ok: false, status: 'blocked', code: 'unsupported-encoding', document };
      if (parse !== undefined) {
        const parsed = document.parse(parse);
        if (!parsed.ok) return { ...parsed, document };
      }
      return { ok: true, document };
    } catch (cause) {
      return { ok: false, status: 'error', code: cause.code || 'open-failed', error: cause.message };
    }
  }

  function checkExternal(document) {
    const session = sessions.get(document);
    if (!session) return unknown();
    const result = store.check(session.snapshot);
    if (result.status === 'conflict' && !session.unverified) session.state = 'conflict';
    return { ...result, saveState: getSaveState(document) };
  }

  function save(document, options = {}) {
    if (!record(options, ['serialize', 'expectedRevision'])) return failure('invalid-options');
    const session = sessions.get(document);
    if (!session) return unknown();
    const revision = revisionError(options.expectedRevision, document.revision);
    if (revision) return failure(revision);
    const { serialize } = options;
    if (session.saving) return failure('save-in-progress');
    if (unresolvedCopy(session)) return failure('unresolved-copy-state', { copyState: getCopyState(document) });
    if (session.unverified) return failure('replacement-unverified', { committed: session.committed, saveState: getSaveState(document) });
    session.saving = true;
    try {
      if (serialize !== undefined) {
        const verified = document.verifySerialization(serialize);
        if (!verified.ok) return { ...verified, committed: false };
      }
      if (document.blocked) return { ok: false, status: 'blocked', code: 'conversion-blocked', committed: false };
      const checked = store.check(session.snapshot);
      if (!checked.ok) {
        session.state = checked.status === 'conflict' ? 'conflict' : session.state;
        return { ...checked, committed: false, saveState: getSaveState(document) };
      }
      if (session.pending) return failure('durability-uncertain', { status: 'error', committed: true, saveState: getSaveState(document) });
      if (!document.dirty) return { ok: true, status: 'unchanged', committed: false, saveState: getSaveState(document) };
      const text = document.text;
      const result = store.replace(session.snapshot, document.bytesForSave());
      // A completed replacement with a directory-sync warning still happened.
      // Advance only a positively verified snapshot; never claim rollback.
      if (result.committed && result.snapshot) {
        session.snapshot = result.snapshot;
        session.acceptSaved(text, result.snapshot.identity);
      }
      session.committed = result.committed;
      session.lastCode = result.code || null;
      if (result.committed === null || (result.committed === true && !result.snapshot)) {
        session.unverified = true;
        session.state = 'replacement-unverified';
      } else if (result.committed === true) {
        session.pending = !result.ok;
        session.state = result.ok ? 'saved-confirmed' : 'durability-uncertain';
      } else session.state = result.status === 'conflict' ? 'conflict'
        : result.status === 'blocked' ? 'not-submitted' : 'failed-unchanged';
      const { snapshot: _privateSnapshot, ...publicResult } = result;
      return { ...publicResult, saveState: Object.freeze({ ...getSaveState(document), state: session.state }) };
    } catch (cause) {
      return { ok: false, status: 'error', code: cause.code || 'save-failed', error: cause.message, committed: false };
    } finally { session.saving = false; }
  }

  function getCopyState(document) {
    const s = sessions.get(document);
    return s ? Object.freeze({ ...(s.copy || { ok: true, state: 'not-created', created: false }) }) : unknown();
  }
  const unresolvedCopy = s => s.copy && !s.copy.ok && s.copy.created !== false;
  function createIsolatedCopy(document, options = {}) {
    if (!record(options, ['name', 'expectedRevision', 'expectedSha256', 'cancelled'])) return failure('invalid-options');
    const s = sessions.get(document);
    if (!s) return unknown();
    if (!s.syntheticTemporary) return failure('synthetic-copy-required');
    if (s.saving) return failure('save-in-progress');
    if (s.pending || s.unverified) return failure('unresolved-save-state');
    if (unresolvedCopy(s)) return failure('unresolved-copy-state', { copyState: getCopyState(document) });
    if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) return failure('invalid-revision');
    const revision = revisionError(options.expectedRevision, document.revision);
    if (revision) return failure(revision);
    if (typeof options.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(options.expectedSha256)
        || (options.cancelled !== undefined && typeof options.cancelled !== 'boolean')) return failure('invalid-create-request');
    if (document.blocked) return failure('conversion-blocked');
    const bytes = document.bytesForSave(), sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== options.expectedSha256) return failure('source-hash-mismatch');
    if (options.cancelled) return { ok: false, code: 'create-cancelled', state: 'not-created', created: false };
    s.saving = true;
    let creationStarted = false;
    try {
      store.authorizeSynthetic(document.filePath);
      const checked = store.check(s.snapshot);
      if (!checked.ok) return { ...checked, state: 'not-created', created: false };
      creationStarted = true;
      const result = store.createCopy(options.name, bytes);
      // The synchronous operation has no await point. Still check for reentrant
      // trusted callbacks, rather than blessing a different source revision.
      if (sessions.get(document) !== s || document.revision !== options.expectedRevision
          || document.blocked || !document.bytesForSave().equals(bytes)) {
        result.ok = false; result.code = 'copy-source-changed';
        if (result.created !== false) result.state = 'created-unverified';
      }
      s.copy = Object.freeze({ ...result, revision: options.expectedRevision, expectedSha256: sha256 });
      return getCopyState(document); // No acceptSaved, baseline, dirty or history change.
    } catch (cause) {
      s.copy = Object.freeze({ ok: false, state: creationStarted ? 'create-outcome-unknown' : 'not-created',
        created: creationStarted ? null : false, code: cause.code || 'create-rejected' });
      return getCopyState(document);
    } finally { s.saving = false; }
  }

  function retryDurability(document, options = {}) {
    if (!record(options, [])) return failure('invalid-options');
    const s = sessions.get(document);
    if (!s) return unknown();
    if (s.saving) return failure('save-in-progress');
    if (s.unverified) return failure('replacement-unverified', { committed: s.committed });
    if (!s.pending) return failure('invalid-save-state');
    s.saving = true;
    try {
      const result = store.confirmDurability(s.snapshot);
      s.lastCode = result.code || null;
      if (result.ok) { s.pending = false; s.state = 'saved-confirmed'; }
      else s.state = result.status === 'conflict' ? 'conflict' : 'durability-uncertain';
      return { ...result, saveState: Object.freeze({ ...getSaveState(document), state: s.state }) };
    } catch {
      return failure('durability-uncertain', { committed: true, saveState: getSaveState(document) });
    } finally { s.saving = false; }
  }

  function close(document) {
    const session = sessions.get(document);
    if (!session) return unknown();
    if (session.saving) return { ok: false, code: 'save-in-progress' };
    if (unresolvedCopy(session)) return failure('unresolved-copy-state', { copyState: getCopyState(document) });
    if (session.pending || session.unverified) return failure('unresolved-save-state', { saveState: getSaveState(document) });
    sessions.delete(document); // No write, conversion or destruction of retained source.
    return { ok: true };
  }

  return { open, save, checkExternal, close, getSaveState, retryDurability, createIsolatedCopy, getCopyState };
}

module.exports = { createDocumentService };
