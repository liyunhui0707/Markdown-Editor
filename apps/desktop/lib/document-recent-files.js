'use strict';
// Main-owned navigation metadata only; separate from user drafts and write authority.
// Reuse the verified private-snapshot protocol rather than another disk writer.
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createDraftStore } = require('./document-draft-store');
const CATALOG = '514812ec-475a-493d-b962-6608bbf68890', LIMIT = 12;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validPath = p => typeof p === 'string' && p.length <= 4096 && path.isAbsolute(p)
  && /\.md$/i.test(p) && !/[\x00-\x1f\x7f]/.test(p) && !path.basename(p).startsWith('.env.') && !p.split(path.sep).includes('secrets');
function createRecentFiles(root) {
  const store = createDraftStore(root); let writeUnknown = false;
  const unavailable = () => ({ ok: false, code: 'recents-unavailable', entries: [] });
  function read() {
    if (writeUnknown) throw Error('Unconfirmed catalog write');
    const list = store.list();
    if (!list.ok || list.archived.length || list.drafts.some(d => d.id !== CATALOG || d.warning || !d.recoverable)) throw Error('Invalid catalog');
    if (!list.drafts.length) return { entries: [], revision: 0 };
    const saved = store.recover(CATALOG);
    if (!saved.ok || saved.warning) throw Error('Unverified catalog');
    const data = JSON.parse(saved.bytes.toString('utf8'));
    if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > LIMIT
        || new Set(data.entries.map(e => e.id)).size !== data.entries.length
        || new Set(data.entries.map(e => e.filePath)).size !== data.entries.length) throw Error('Invalid entries');
    for (const e of data.entries) {
      if (!uuid.test(e.id) || !validPath(e.filePath) || !/^[a-f0-9]{64}$/.test(e.sha256)
          || !/^\d{1,30}$/.test(e.dev) || !/^\d{1,30}$/.test(e.ino)
          || !Number.isSafeInteger(e.time) || e.time < 0) throw Error('Invalid entry');
    }
    return { ...data, token: saved.token, fingerprint: saved.identity, revision: saved.revision };
  }
  function write(current, entries) {
    const result = store.save({ id: CATALOG, label: 'Recent document locations', revision: current.revision + 1,
      token: current.token, fingerprint: current.fingerprint, bytes: Buffer.from(JSON.stringify({ version: 1, entries })) });
    if (!result.ok) { writeUnknown = true; return unavailable(); }
    return { ok: true };
  }
  function list() {
    try { return { ok: true, entries: read().entries.map(e => ({ id: e.id, label: path.basename(e.filePath), location: path.dirname(e.filePath), time: e.time })) }; }
    catch { return unavailable(); }
  }
  function remember(document) {
    try {
      if (!validPath(document.filePath) || document.blocked) return unavailable();
      const current = read(), e = { id: randomUUID(), filePath: document.filePath,
        dev: document.identity.dev, ino: document.identity.ino, sha256: hash(document.originalBytes), time: Date.now() };
      return write(current, [e, ...current.entries.filter(p => p.filePath !== e.filePath)].slice(0, LIMIT));
    } catch { return unavailable(); }
  }
  function resolve(id) {
    try { if (typeof id !== 'string' || !uuid.test(id)) return null; return read().entries.find(e => e.id === id) || null; }
    catch { return null; }
  }
  function matches(entry, document) {
    return entry && entry.filePath === document.filePath && entry.dev === document.identity.dev
      && entry.ino === document.identity.ino && entry.sha256 === hash(document.originalBytes);
  }
  function clear() { try { const current = read(); return current.entries.length ? write(current, []) : { ok: true }; } catch { return unavailable(); } }
  return { list, remember, resolve, matches, clear };
}
module.exports = { createRecentFiles };
