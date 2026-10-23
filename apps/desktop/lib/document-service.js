'use strict';
const { DocumentModel } = require('./document-model');
const { createDocumentFileStore } = require('./document-file-store');

// A local main-process capability, NOT an arbitrary-path renderer IPC API.
// Future document opening must authorize paths before handing out session IDs.
function createDocumentService(options = {}) {
  const store = createDocumentFileStore(options);
  const sessions = new WeakMap();
  const unknown = () => ({ ok: false, status: 'blocked', code: 'unknown-document', committed: false });

  function open(filePath, { parse } = {}) {
    try {
      const snapshot = store.read(filePath);
      const document = new DocumentModel({ filePath, bytes: snapshot.bytes, identity: snapshot.identity });
      sessions.set(document, { snapshot, saving: false });
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
    return session ? store.check(session.snapshot) : unknown();
  }

  function save(document, { serialize } = {}) {
    const session = sessions.get(document);
    if (!session) return unknown();
    if (session.saving) return { ok: false, status: 'blocked', code: 'save-in-progress', committed: false };
    session.saving = true;
    try {
      if (serialize !== undefined) {
        const verified = document.verifySerialization(serialize);
        if (!verified.ok) return { ...verified, committed: false };
      }
      if (document.blocked) return { ok: false, status: 'blocked', code: 'conversion-blocked', committed: false };
      const checked = store.check(session.snapshot);
      if (!checked.ok) return { ...checked, committed: false };
      if (!document.dirty) return { ok: true, status: 'unchanged', committed: false };
      const text = document.text;
      const result = store.replace(session.snapshot, document.bytesForSave());
      // A completed replacement with a directory-sync warning still happened.
      // Advance only a positively verified snapshot; never claim rollback.
      if (result.committed && result.snapshot) {
        session.snapshot = result.snapshot;
        document.acceptSaved(text, result.snapshot.identity);
      }
      const { snapshot: _privateSnapshot, ...publicResult } = result;
      return publicResult;
    } catch (cause) {
      return { ok: false, status: 'error', code: cause.code || 'save-failed', error: cause.message, committed: false };
    } finally { session.saving = false; }
  }

  function close(document) {
    const session = sessions.get(document);
    if (!session) return unknown();
    if (session.saving) return { ok: false, code: 'save-in-progress' };
    sessions.delete(document); // No write, conversion or destruction of retained source.
    return { ok: true };
  }

  return { open, save, checkExternal, close };
}

module.exports = { createDocumentService };
