'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { record, failure } = require('./document-contract');
const CHANNEL = 'document-demo:request';
const sourceHash = source => createHash('sha256').update(source).digest('hex');

// Main-owned capabilities. No path-opening or policy-construction IPC exists.
function createDocumentSessions({ service, projectSource, mapTextEdit, windowFor }) {
  const bindings = new Map(), sessions = new Map(), retained = new Set();
  function invalidate(id, s) {
    sessions.delete(id); // Revoke authority before notifying the captured owner.
    try { if (!s.sender.isDestroyed()) s.sender.send('document-demo:invalidated', { sessionId: id }); }
    catch { /* A destroyed recipient cannot receive notifications; authority is already gone. */ }
  }
  function revoke(win) {
    for (const [wc, binding] of bindings) if (binding.win === win) bindings.delete(wc);
    for (const [id, s] of sessions) if (s.win === win) {
      invalidate(id, s);
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
    const id = randomUUID(); sessions.set(id, { win, sender: win.webContents, document, label, undo: [], redo: [] }); return id;
  }
  function snapshot(id, s) {
    return { sessionId: id, label: s.label, source: s.document.text, revision: s.document.revision,
      dirty: s.document.dirty, blocked: s.document.blocked, bom: s.document.bom, encoding: s.document.encoding,
      canUndo: s.undo.length > 0, canRedo: s.redo.length > 0,
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
      save: ['operation', 'sessionId', 'expectedRevision'], close: ['operation', 'sessionId', 'expectedRevision'],
      undo: ['operation', 'sessionId', 'expectedRevision'], redo: ['operation', 'sessionId', 'expectedRevision'] };
    if (!record(payload, ['operation', 'sessionId', 'expectedRevision', 'from', 'to', 'insert'])
        || typeof payload.operation !== 'string' || !Object.hasOwn(fields, payload.operation)
        || !record(payload, fields[payload.operation])) return failure('invalid-request');
    if (payload.operation === 'list') return { ok: true, sessions: [...sessions].filter(([, s]) => s.win === binding.win)
      .map(([id, s]) => ({ sessionId: id, label: s.label })) };
    const id = payload.sessionId, s = typeof id === 'string' ? sessions.get(id) : null;
    if (!s || s.win !== binding.win) return failure('unknown-session');
    const reply = result => ({ ok: result.ok, status: result.status, code: result.code,
      committed: result.committed, selection: result.selection, snapshot: snapshot(id, s) }); // no fs paths/objects/error strings
    if (['edit', 'save', 'close', 'undo', 'redo'].includes(payload.operation)) {
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
          const result = service.close(s.document); if (result.ok) invalidate(id, s); return { ok: result.ok, code: result.code };
        }
        case 'edit': {
          const before = s.document.text;
          const change = { from: payload.from, to: payload.to, insert: payload.insert };
          const mapped = mapTextEdit(before, change);
          if (!mapped.ok) return reply(failure(mapped.code));
          const removed = before.slice(mapped.change.from, mapped.change.to);
          if (removed.length > 4096) return reply(failure('history-range-limit'));
          const result = s.document.edit({ ...mapped.change, expectedRevision: payload.expectedRevision });
          if (result.ok && s.document.text !== before) {
            s.undo.push({ before: sourceHash(before), after: sourceHash(s.document.text), redo: change, leaf: mapped.leaf, paragraphSeparator: mapped.paragraphSeparator || null,
              undo: mapped.inverse || { from: change.from, to: change.from + change.insert.length, insert: removed } });
            if (s.undo.length > 64) s.undo.shift();
            s.redo = [];
          }
          return reply(result);
        }
        case 'undo': case 'redo': {
          const undoing = payload.operation === 'undo', stack = undoing ? s.undo : s.redo;
          const entry = stack.at(-1);
          if (!entry) return reply(failure('history-empty'));
          const fromHash = undoing ? entry.after : entry.before, toHash = undoing ? entry.before : entry.after;
          if (sourceHash(s.document.text) !== fromHash) return reply(failure('history-diverged'));
          const change = entry[payload.operation], mapped = mapTextEdit(s.document.text, change, entry.leaf, entry.paragraphSeparator);
          if (!mapped.ok || sourceHash(mapped.source) !== toHash) return reply(failure('history-diverged'));
          const result = s.document.edit({ ...mapped.change, expectedRevision: payload.expectedRevision });
          if (result.ok) {
            stack.pop(); (undoing ? s.redo : s.undo).push(entry);
            result.selection = mapped.selection || { from: change.from + change.insert.length, to: change.from + change.insert.length };
          }
          return reply(result);
        }
      }
    } catch { return reply(failure('document-operation-failed')); }
  }
  return { grant, provision, request, revoke, retainedCount: () => retained.size };
}
function registerDocumentIpc(ipcMain, manager) { ipcMain.handle(CHANNEL, (event, request) => manager.request(event, request)); }
module.exports = { CHANNEL, createDocumentSessions, registerDocumentIpc };
