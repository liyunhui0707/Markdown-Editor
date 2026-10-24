'use strict';
const { randomUUID } = require('node:crypto');
const { record, failure } = require('./document-contract');
const CHANNEL = 'document-demo:request';

// Main-owned capabilities. No path-opening or policy-construction IPC exists.
function createDocumentSessions({ service, projectSource, mapTextEdit, windowFor }) {
  const bindings = new Map(), sessions = new Map(), retained = new Set();
  function revoke(win) {
    for (const [wc, binding] of bindings) if (binding.win === win) bindings.delete(wc);
    for (const [id, s] of sessions) if (s.win === win) {
      sessions.delete(id);
      const state = service.getSaveState(s.document);
      if (s.document.dirty || state.durabilityUncertain || state.replacementUnverified) retained.add(s.document);
      else service.close(s.document);
    }
  }
  function grant(win, url) {
    if (bindings.has(win.webContents) || typeof url !== 'string' || !url.startsWith('file:')) throw Error('Invalid binding');
    bindings.set(win.webContents, { win, url });
    win.once('closed', () => revoke(win));
    for (const name of ['did-start-loading', 'destroyed', 'render-process-gone']) win.webContents.once(name, () => revoke(win));
  }
  function provision(win, document, label) {
    if (!bindings.has(win.webContents) || typeof document.text !== 'string' || document.text.length > 131072
        || !service.getSaveState(document).ok || sessions.size >= 8 || typeof label !== 'string') throw Error('Invalid provisioning');
    projectSource(document.text);
    const id = randomUUID(); sessions.set(id, { win, document, label }); return id;
  }
  function snapshot(id, s) {
    return { sessionId: id, label: s.label, source: s.document.text, revision: s.document.revision,
      dirty: s.document.dirty, blocked: s.document.blocked, bom: s.document.bom, encoding: s.document.encoding,
      lineEndings: { ...s.document.lineEndings }, saveState: { ...service.getSaveState(s.document) } };
  }
  function request(event, payload) {
    let binding;
    try {
      binding = bindings.get(event.sender);
      if (!binding || binding.win.isDestroyed() || event.sender.isDestroyed()
        || windowFor(event.sender) !== binding.win || event.senderFrame !== event.sender.mainFrame
        || event.senderFrame.url !== binding.url || event.sender.getURL() !== binding.url) return failure('unauthorized-sender');
    } catch { return failure('unauthorized-sender'); }
    const fields = { list: ['operation'], snapshot: ['operation', 'sessionId'], check: ['operation', 'sessionId'],
      edit: ['operation', 'sessionId', 'expectedRevision', 'from', 'to', 'insert'],
      save: ['operation', 'sessionId', 'expectedRevision'], close: ['operation', 'sessionId', 'expectedRevision'] };
    if (!record(payload, ['operation', 'sessionId', 'expectedRevision', 'from', 'to', 'insert'])
        || typeof payload.operation !== 'string' || !Object.hasOwn(fields, payload.operation)
        || !record(payload, fields[payload.operation])) return failure('invalid-request');
    if (payload.operation === 'list') return { ok: true, sessions: [...sessions].filter(([, s]) => s.win === binding.win)
      .map(([id, s]) => ({ sessionId: id, label: s.label })) };
    const id = payload.sessionId, s = typeof id === 'string' ? sessions.get(id) : null;
    if (!s || s.win !== binding.win) return failure('unknown-session');
    const reply = result => ({ ok: result.ok, status: result.status, code: result.code,
      committed: result.committed, snapshot: snapshot(id, s) }); // no fs paths/objects/error strings
    if (['edit', 'save', 'close'].includes(payload.operation)) {
      if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) return reply(failure('invalid-revision'));
      if (payload.expectedRevision !== s.document.revision) return reply(failure('stale-revision'));
    }
    try {
      switch (payload.operation) {
        case 'snapshot': return reply({ ok: true });
        case 'check': return reply(service.checkExternal(s.document));
        case 'save': return reply(service.save(s.document, { expectedRevision: payload.expectedRevision }));
        case 'close': {
          const state = service.getSaveState(s.document);
          if (s.document.dirty || state.durabilityUncertain || state.replacementUnverified) return reply(failure('unresolved-save-state'));
          const result = service.close(s.document); if (result.ok) sessions.delete(id); return { ok: result.ok, code: result.code };
        }
        case 'edit': {
          const mapped = mapTextEdit(s.document.text, { from: payload.from, to: payload.to, insert: payload.insert });
          if (!mapped.ok) return reply(failure(mapped.code));
          return reply(s.document.edit({ ...mapped.change, expectedRevision: payload.expectedRevision }));
        }
      }
    } catch { return reply(failure('document-operation-failed')); }
  }
  return { grant, provision, request, revoke, retainedCount: () => retained.size };
}
function registerDocumentIpc(ipcMain, manager) { ipcMain.handle(CHANNEL, (event, request) => manager.request(event, request)); }
module.exports = { CHANNEL, createDocumentSessions, registerDocumentIpc };
