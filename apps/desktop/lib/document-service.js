'use strict';
const { createDocumentModel } = require('./document-model');
const { createDocumentFileStore } = require('./document-file-store');
const { record, failure, revisionError } = require('./document-contract');

// A local main-process capability, NOT an arbitrary-path renderer IPC API.
// Future document opening must authorize paths before handing out session IDs.
function createDocumentService(options = {}) {
  // Trusted main-process construction only, never an IPC payload.
  if (!record(options, ['fs', 'unsafeExperimentalRoot'])) throw TypeError('Invalid service construction options');
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
    if (!record(options, ['parse'])) return failure('invalid-options');
    const { parse } = options;
    try {
      const snapshot = store.read(filePath);
      const { document, acceptSaved } = createDocumentModel({ filePath, bytes: snapshot.bytes, identity: snapshot.identity });
      sessions.set(document, { snapshot, acceptSaved, saving: false, state: 'not-submitted', committed: false,
        pending: false, unverified: false, lastCode: null });
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
    if (session.pending || session.unverified) return failure('unresolved-save-state', { saveState: getSaveState(document) });
    sessions.delete(document); // No write, conversion or destruction of retained source.
    return { ok: true };
  }

  return { open, save, checkExternal, close, getSaveState, retryDurability };
}

module.exports = { createDocumentService };
