'use strict';
const {MAX_SOURCE_UNITS, MAX_DOCUMENT_BYTES} = require('./document-capacity');
const {trimHistory} = require('./document-history-budget');
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { record, failure } = require('./document-contract');
const { createDraftBackups } = require('./document-draft-backups');
const { closeDocumentSession } = require('./document-close');
const { normalizeDraftName, draftFileName } = require('./document-draft-name');
const CHANNEL = 'document-demo:request';
const { supportedOpenPath } = require('./document-native-open');
const { sourceChange } = require('./document-source-edit');
const sourceHash = source => createHash('sha256').update(source).digest('hex');

// Main-owned native selection / confirmed receipt authority; no renderer paths or policies.
function createDocumentSessions({ service, projectSource, mapTextEdit, mapFormatEdit = null, windowFor, chooseFile = null, createTemporary = null, allowTestCopies = false, chooseCopy = null, draftStore = null, revealFile = null, confirmClose = null, recentFiles = null, images = null, chooseImage = null, nativeOpens = null, confirmOriginalSave = null }) {
  const bindings = new Map(), sessions = new Map(), retained = new Set();
  const backups = draftStore && createDraftBackups(draftStore, (document, backup) => {
    for (const [sessionId, s] of sessions) if (s.document === document) {
      try { if (!s.sender.isDestroyed()) s.sender.send('document-demo:draft-status', { sessionId, backup }); }
      catch { /* Backup remains on disk even when renderer is gone. */ }
    }
  }, document => images?.attachments(document) || []);
  function invalidate(id, s) {
    backups?.release(s.document);
    sessions.delete(id); // Revoke authority before notifying the captured owner.
    try { if (!s.sender.isDestroyed()) s.sender.send('document-demo:invalidated', { sessionId: id }); }
    catch { /* A destroyed recipient cannot receive notifications; authority is already gone. */ }
  }
  function revoke(win) {
    for (const [wc, binding] of bindings) if (binding.win === win) bindings.delete(wc);
    for (const [id, s] of sessions) if (s.win === win) {
      invalidate(id, s);
      const state = service.getSaveState(s.document);
      if (s.copying || s.document.dirty || state.durabilityUncertain || state.replacementUnverified
          || service.getCopyState(s.document).created !== false && !service.getCopyState(s.document).ok) retained.add(s.document);
      else service.close(s.document);
    }
  }
  function grant(win, url) {
    if (bindings.has(win.webContents) || typeof url !== 'string' || !url.startsWith('file:')) throw Error('Invalid binding');
    bindings.set(win.webContents, { win, url, temporaryCount: 0 });
    win.once('closed', () => revoke(win));
    for (const name of ['did-start-loading', 'destroyed', 'render-process-gone']) win.webContents.once(name, () => revoke(win));
  }
  function provision(win, document, label, options = {}) {
    if (!record(options, ['readOnly', 'temporary']) || (options.readOnly !== undefined && typeof options.readOnly !== 'boolean')
        || (options.temporary !== undefined && typeof options.temporary !== 'boolean') || (options.temporary && options.readOnly)) throw Error('Invalid provisioning options');
    if (!bindings.has(win.webContents) || typeof document.text !== 'string' || document.text.length > MAX_SOURCE_UNITS
        || !service.getSaveState(document).ok || sessions.size >= 8 || typeof label !== 'string') throw Error('Invalid provisioning');
    projectSource(document.text);
    const id = randomUUID(); sessions.set(id, { win, sender: win.webContents, document, label, readOnly: options.readOnly === true, temporary: options.temporary === true, undo: [], redo: [] }); return id;
  }
  function copyState(s, receipt = service.getCopyState(s.document)) {
    if (!receipt) return null;
    const safe = {};
    for (const key of ['ok', 'state', 'created', 'code', 'filePath', 'revision', 'sha256', 'byteLength', 'copyId', 'attachments', 'attachmentPaths'])
      if (Object.hasOwn(receipt, key)) safe[key] = receipt[key];
    return safe;
  }
  function snapshot(id, s) {
    let copySha256 = null;
    if (allowTestCopies && s.temporary && !s.document.blocked) {
      try { copySha256 = sourceHash(s.document.bytesForSave()); } catch { /* No create authority for unconvertible contents. */ }
    }
    return { linkedFile: service.getLinkedFile?.(s.document) || null, originalSave: service.getOriginalState?.(s.document) || null, ...(backups?.status(s.document) ? { draftBackup: backups.status(s.document) } : {}), ...(allowTestCopies && s.temporary ? { copyEnabled: true, persistentCopyEnabled: typeof chooseCopy === 'function', copySha256, copyState: copyState(s), confirmedCopy: copyState(s, service.getConfirmedCopy(s.document)) } : {}), sessionId: id, label: s.label, ...(s.temporary ? { temporary: true, readOnly: false } : {}), ...(s.readOnly ? { readOnly: true, location: path.dirname(s.document.filePath), editCopyEnabled: typeof createTemporary === 'function', editCopySha256: s.document.blocked ? null : sourceHash(s.document.bytesForSave()) } : {}), source: s.document.text, revision: s.document.revision,
      dirty: s.document.dirty, blocked: s.document.blocked, bom: s.document.bom, encoding: s.document.encoding,
      canUndo: s.undo.length > 0, canRedo: s.redo.length > 0,
      lineEndings: { ...s.document.lineEndings }, saveState: { ...service.getSaveState(s.document) } };
  }
  function authorizedBinding(event) {
    try {
      const binding = bindings.get(event.sender);
      if (!binding || binding.win.isDestroyed() || event.sender.isDestroyed()
        || windowFor(event.sender) !== binding.win || event.senderFrame !== event.sender.mainFrame
        || event.senderFrame.url !== binding.url || event.sender.getURL() !== binding.url) return null;
      return binding;
    } catch { return null; }
  }
  async function openSelected(event, binding) {
    if (typeof chooseFile !== 'function') return failure('open-unavailable');
    if (binding.opening) return failure('open-busy');
    binding.opening = true;
    try {
      const selected = await chooseFile(binding.win);
      if (authorizedBinding(event) !== binding) return failure('unauthorized-sender');
      if (selected?.canceled === true) return failure('open-cancelled');
      const file = selected?.filePaths?.[0];
      if (selected?.canceled !== false || !Array.isArray(selected.filePaths) || selected.filePaths.length !== 1
          || !supportedOpenPath(file)) return failure('unsupported-path');
      return openPath(event, binding, file);
    } catch { return failure('open-failed'); }
    finally { binding.opening = false; }
  }
  function openPath(event, binding, file, recent = null, native = false) {
    if (!native && sessions.size >= 8) return failure('session-limit');
    const opened = service.open(file, { parse: projectSource, maxBytes: MAX_DOCUMENT_BYTES });
    if (!opened.ok) {
      if (opened.document) service.close(opened.document);
      const code = ['ENOENT', 'ENOTDIR'].includes(opened.code) ? 'file-unavailable'
        : ['EACCES', 'EPERM'].includes(opened.code) ? 'read-failed'
        : ['unsupported-path', 'unsupported-file', 'unsupported-size', 'unsupported-encoding', 'parse-failed', 'external-change'].includes(opened.code) ? opened.code : 'open-failed';
      return failure(code);
    }
    try {
      if (authorizedBinding(event) !== binding) { service.close(opened.document); return failure('unauthorized-sender'); }
      if (recent && !recentFiles.matches(recent, opened.document)) { service.close(opened.document); return failure('recent-file-unavailable'); }
      if (native) {
        // Re-read first: duplicate OS opens must not silently focus stale bytes.
        for (const [id, s] of sessions) if (s.win === binding.win && s.readOnly
            && (s.document.filePath === file || (s.document.identity.dev === opened.document.identity.dev
              && s.document.identity.ino === opened.document.identity.ino))) {
          // Read-only reuse is about identity and exact contents. OS last-use metadata
          // may change after Finder opens a file; this grants no save authority.
          const same = s.document.identity.dev === opened.document.identity.dev
            && s.document.identity.ino === opened.document.identity.ino
            && s.document.originalBytes.equals(opened.document.originalBytes);
          service.close(opened.document);
          return same ? { ok: true, reused: true, snapshot: snapshot(id, s) } : failure('native-file-changed');
        }
        if (sessions.size >= 8) { service.close(opened.document); return failure('session-limit'); }
      }
      images?.open(opened.document);
      const id = provision(binding.win, opened.document, path.basename(file), { readOnly: true });
      try { recentFiles?.remember(opened.document); } catch { /* A history failure cannot undo a valid open. */ }
      return { ok: true, ...(recent ? { recentId: recent.id } : {}), snapshot: snapshot(id, sessions.get(id)) };
    } catch { service.close(opened.document); return failure('open-failed'); }
  }
  function openRecent(event, binding, id) {
    if (binding.opening) return failure('open-busy');
    const entry = recentFiles?.resolve(id);
    if (!entry) return failure('recent-file-unavailable');
    const result = openPath(event, binding, entry.filePath, entry);
    return result.ok || result.code === 'session-limit' ? result : failure('recent-file-unavailable');
  }
  function newTemporary(binding, source = null, isAuthorized = () => true, recovery = null) {
    if (typeof createTemporary !== 'function') return failure('temporary-unavailable');
    if (sessions.size >= 8) return failure('session-limit');
    let opened;
    try {
      const bytes = recovery ? recovery.bytes : source ? source.document.bytesForSave() : Buffer.alloc(0);
      opened = createTemporary(Buffer.from(bytes)); // Synchronous main factory; never renderer bytes/path.
      if (!isAuthorized()) return failure('copy-session-invalidated');
      if (!opened?.document || opened.document === source?.document || opened.document.blocked
          || opened.document.revision !== 0 || opened.document.dirty || !opened.document.bytesForSave().equals(bytes)) return failure('temporary-create-failed');
      if (!opened?.ok) return failure('temporary-create-failed');
      const number = ++binding.temporaryCount;
      const label = recovery ? recovery.label : source ? `${source.label.replace(/\.md$/i, '')} · 编辑副本 ${number}` : '未命名 ' + number;
      images?.attach(opened.document, source?.document, recovery);
      const id = provision(binding.win, opened.document, label, { temporary: true });
      backups?.attach(opened.document, label, recovery);
      if(source?.readOnly)service.bindOriginal?.(opened.document,source.document);
      return { ok: true, snapshot: snapshot(id, sessions.get(id)) };
    } catch { return failure('temporary-create-failed'); }
    finally { if (opened?.document && ![...sessions.values()].some(s => s.document === opened.document)) service.close(opened.document); }
  }
  async function persistentCopy(event, binding, id, s, payload) {
    if (!allowTestCopies || !s.temporary || typeof chooseCopy !== 'function') return failure('persistent-copy-unavailable');
    s.copying = true;
    const authorized = () => authorizedBinding(event) === binding && sessions.get(id) === s;
    try {
      if (payload.expectedSha256 !== sourceHash(s.document.bytesForSave())) return failure('source-hash-mismatch');
      const selected = await chooseCopy(binding.win, { suggestedName: draftFileName(s.label) });
      if (!authorized()) return failure('copy-session-invalidated');
      let result;
      if (selected?.canceled === true) result = { ok: false, code: 'create-cancelled', state: 'not-created', created: false };
      else if (selected?.canceled !== false || typeof selected.filePath !== 'string') result = failure('invalid-copy-selection');
      else result = await service.createPersistentCopy(s.document, { filePath: selected.filePath,
        expectedRevision: payload.expectedRevision, expectedSha256: payload.expectedSha256, isAuthorized: authorized });
      if (!authorized()) { retained.add(s.document); return { ok: false, code: 'copy-session-invalidated', copy: copyState(s) }; }
      return { ok: result.ok, code: result.code, snapshot: snapshot(id, s), copy: result.state ? result : copyState(s) };
    } catch { return { ok: false, code: 'persistent-copy-failed', copy: copyState(s), ...(authorized() ? { snapshot: snapshot(id, s) } : {}) }; }
    finally { s.copying = false; }
  }
  async function importImage(event, binding, id, s, payload) {
    if (!images || !chooseImage || !s.temporary || s.readOnly || s.document.blocked) return failure('image-import-unavailable');
    s.copying = true;
    try {
      const selected = await chooseImage(binding.win);
      if (authorizedBinding(event) !== binding || sessions.get(id) !== s || s.document.revision !== payload.expectedRevision) return failure('image-session-changed');
      if (selected?.canceled === true) return failure('image-cancelled');
      if (selected?.canceled !== false || !Array.isArray(selected.filePaths) || selected.filePaths.length !== 1) return failure('invalid-image-selection');
      const href = images.importFile(s.document, selected.filePaths[0]);
      return {ok: true, sessionId: id, revision: s.document.revision, href};
    } catch (cause) { return failure(cause.code || 'image-import-failed'); }
    finally { s.copying = false; }
  }
  function followCopy(event, binding, id, s, payload) {
    if (!allowTestCopies || !s.temporary || s.readOnly) return failure('confirmed-copy-unavailable');
    const opening = payload.operation === 'open-confirmed-copy';
    if (opening && sessions.size >= 8) return failure('session-limit');
    if (!opening && typeof revealFile !== 'function') return failure('copy-reveal-unavailable');
    s.copying = true;
    let result, kept = false;
    try {
      result = opening ? service.openConfirmedCopy(s.document, payload.copyId, projectSource)
        : service.locateConfirmedCopy(s.document, payload.copyId);
      if (authorizedBinding(event) !== binding || sessions.get(id) !== s) return failure('copy-session-invalidated');
      if (!result.ok) return failure('confirmed-copy-unavailable');
      if (!opening) {
        revealFile(result.filePath); // Verified main-owned path; a display request, not a write.
        return { ok: true, copyId: payload.copyId };
      }
      images?.open(result.document);
      const next = provision(binding.win, result.document, path.basename(result.document.filePath), { readOnly: true });
      const view = snapshot(next, sessions.get(next)); kept = true;
      try { recentFiles?.remember(result.document); } catch { /* Verified open is independent of navigation history. */ }
      return { ok: true, copyId: payload.copyId, snapshot: view };
    } catch { return failure(opening ? 'copy-open-failed' : 'copy-reveal-failed'); }
    finally { s.copying = false; if (result?.document && !kept) service.close(result.document); }
  }
  function followLinked(event,binding,id,s,payload){
    const opening=payload.operation==='open-linked-file';
    if(opening&&sessions.size>=8)return failure('session-limit');
    if(!opening&&typeof revealFile!=='function')return failure('copy-reveal-unavailable');
    s.copying=true;let result,kept=false;
    try{
      result=opening?service.openLinkedFile(s.document,projectSource):service.locateLinkedFile(s.document);
      if(authorizedBinding(event)!==binding||sessions.get(id)!==s)return failure('unknown-session');
      if(!result.ok)return failure(result.code||'linked-file-unavailable');
      if(!opening){revealFile(result.filePath);return {ok:true,sessionId:id,requestRevision:payload.expectedRevision};}
      images?.open(result.document);
      const next=provision(binding.win,result.document,path.basename(result.document.filePath),{readOnly:true});
      const view=snapshot(next,sessions.get(next));kept=true;
      try{recentFiles?.remember(result.document);}catch{/* Navigation history does not affect verified reading. */}
      return {ok:true,sessionId:id,requestRevision:payload.expectedRevision,snapshot:view};
    }catch{return failure('linked-file-unavailable');}
    finally{s.copying=false;if(result?.document&&!kept)service.close(result.document);}
  }
  async function saveOriginal(event,binding,id,s,payload){
    if(!s.temporary||s.readOnly||!confirmOriginalSave||!service.getOriginalState(s.document))return failure('original-save-unavailable');
    s.copying=true;
    const authorized=()=>authorizedBinding(event)===binding&&sessions.get(id)===s&&s.document.revision===payload.expectedRevision;
    try {
      if(!backups?.verifyForClose(s.document))return {ok:false,code:'save-backup-unverified',snapshot:snapshot(id,s)};
      const origin=service.getOriginalState(s.document);
      if(origin.stopped)return {ok:false,code:'unresolved-save-state',snapshot:snapshot(id,s)};
      if(s.originalSaveAccepted!==origin.filePath){
        if(await confirmOriginalSave(s.win,origin.filePath)!==true)return {ok:false,code:'save-cancelled',snapshot:snapshot(id,s)};
        if(!authorized())return failure('save-authorization-expired');s.originalSaveAccepted=origin.filePath;
      }
      const result=await service.saveOriginal(s.document,{expectedRevision:payload.expectedRevision,isAuthorized:authorized});
      return authorized()?{...result,snapshot:snapshot(id,s)}:failure('save-outcome-unknown');
    }catch{return {ok:false,code:'save-outcome-unknown',...(authorized()?{snapshot:snapshot(id,s)}:{})};}
    finally{s.copying=false;}
  }
  function request(event, payload) {
    const binding = authorizedBinding(event);
    if (!binding) return failure('unauthorized-sender');
    const fields = { 'inspect-linked-file':['operation','sessionId','expectedRevision'], 'open-linked-file':['operation','sessionId','expectedRevision'], 'reveal-linked-file':['operation','sessionId','expectedRevision'], 'save-original':['operation','sessionId','expectedRevision'], 'list-save-recoveries':['operation'], 'reveal-save-recovery':['operation','recordId'], 'list-native-opens': ['operation'], 'dismiss-native-open': ['operation', 'requestId'], 'open-native-file': ['operation', 'requestId'], 'import-image': ['operation', 'sessionId', 'expectedRevision'], 'image-preview': ['operation', 'sessionId', 'expectedRevision', 'href'], 'rename-draft': ['operation', 'sessionId', 'expectedRevision', 'expectedLabel', 'label'], 'list-recents': ['operation'], 'clear-recents': ['operation'], 'open-recent': ['operation', 'recentId'], 'close-document': ['operation', 'sessionId', 'expectedRevision'], 'open-confirmed-copy': ['operation', 'sessionId', 'expectedRevision', 'copyId'], 'reveal-confirmed-copy': ['operation', 'sessionId', 'expectedRevision', 'copyId'], 'edit-copy': ['operation', 'sessionId', 'expectedRevision', 'expectedSha256'], 'create-persistent-copy': ['operation', 'sessionId', 'expectedRevision', 'expectedSha256'], 'create-test-copy': ['operation', 'sessionId', 'expectedRevision', 'expectedSha256'], 'manage-draft': ['operation', 'draftId', 'action', 'expectedToken'], 'list-drafts': ['operation'], 'restore-draft': ['operation', 'draftId'], 'new-temporary': ['operation'], 'open-file': ['operation'], list: ['operation'], snapshot: ['operation', 'sessionId'], check: ['operation', 'sessionId'],
      format: ['operation', 'sessionId', 'expectedRevision', 'from', 'to', 'action', 'label', 'href'],
      'source-edit': ['operation', 'sessionId', 'expectedRevision', 'from', 'to', 'insert'],
      edit: ['operation', 'sessionId', 'expectedRevision', 'from', 'to', 'insert'],
      save: ['operation', 'sessionId', 'expectedRevision'], close: ['operation', 'sessionId', 'expectedRevision'],
      undo: ['operation', 'sessionId', 'expectedRevision'], redo: ['operation', 'sessionId', 'expectedRevision'] };
    if (!record(payload, ['operation', 'sessionId', 'expectedRevision', 'expectedSha256', 'from', 'to', 'insert', 'draftId', 'action', 'expectedToken', 'copyId', 'label', 'href', 'recentId', 'expectedLabel', 'requestId', 'recordId'])
        || typeof payload.operation !== 'string' || !Object.hasOwn(fields, payload.operation)
        || !record(payload, fields[payload.operation])) return failure('invalid-request');
    if (['list-native-opens', 'dismiss-native-open', 'open-native-file'].includes(payload.operation)) {
      if (!nativeOpens) return failure('native-open-unavailable');
      if (payload.operation === 'list-native-opens') return nativeOpens.list();
      if (typeof payload.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.requestId)) return failure('invalid-request');
      if (payload.operation === 'dismiss-native-open') return nativeOpens.dismiss(payload.requestId);
      if (binding.opening || [...sessions.values()].some(s => s.win === binding.win && (s.copying || s.closing)))
        return { ...failure('open-busy'), requestId: payload.requestId };
      return nativeOpens.consume(payload.requestId, file => openPath(event, binding, file, null, true));
    }
    if(payload.operation==='list-save-recoveries')return service.listSaveRecoveries();
    if(payload.operation==='reveal-save-recovery'){try{const p=service.locateSaveRecovery(payload.recordId);if(!p||!revealFile)return failure('save-recovery-unavailable');revealFile(p);return {ok:true};}catch{return failure('save-recovery-unavailable');}}
    if (payload.operation === 'list-recents') return recentFiles?.list() || failure('recents-unavailable');
    if (payload.operation === 'clear-recents') return recentFiles?.clear() || failure('recents-unavailable');
    if (payload.operation === 'open-recent') return openRecent(event, binding, payload.recentId);
    if (['list-drafts', 'restore-draft', 'manage-draft'].includes(payload.operation)) {
      if (!draftStore) return failure('drafts-unavailable');
      try {
        if (payload.operation === 'list-drafts') {
          const result = draftStore.list();
          return { ...result, drafts: result.drafts.map(d => ({ ...d, active: backups.active(d.id) })) };
        }
        if (typeof payload.draftId !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.draftId)) return failure('invalid-draft');
        if (backups.active(payload.draftId)) return failure('draft-already-open');
        if (payload.operation === 'manage-draft') {
          if (!['archive', 'unarchive'].includes(payload.action) || typeof payload.expectedToken !== 'string'
              || !/^[a-f0-9]{64}$/.test(payload.expectedToken)) return failure('invalid-draft-operation');
          return draftStore.manage(payload.draftId, payload.action, payload.expectedToken);
        }
        const recovered = draftStore.recover(payload.draftId);
        if (!recovered.ok) return failure(recovered.code);
        const result = newTemporary(binding, null, () => authorizedBinding(event) === binding, recovered);
        return { ...result, ...(result.ok ? { recovered: { revision: recovered.revision, warning: recovered.warning } } : {}) };
      } catch { return failure('draft-read-failed'); }
    }
    if (payload.operation === 'new-temporary') return newTemporary(binding);
    if (payload.operation === 'open-file') return openSelected(event, binding);
    if (payload.operation === 'list') return { ok: true, sessions: [...sessions].filter(([, s]) => s.win === binding.win)
      .map(([id, s]) => ({ sessionId: id, label: s.label })) };
    const id = payload.sessionId, s = typeof id === 'string' ? sessions.get(id) : null;
    if (!s || s.win !== binding.win) return failure('unknown-session');
    const reply = result => ({ ok: result.ok, status: result.status, code: result.code,
      committed: result.committed, selection: result.selection, snapshot: snapshot(id, s) }); // Only bounded snapshots/receipts; no fs objects or raw exception strings
    if (payload.operation === 'close-document') return closeDocumentSession({ id, session: s,
      revision: payload.expectedRevision, authorized: () => authorizedBinding(event) === binding && sessions.get(id) === s,
      service, backups, confirm: confirmClose, invalidate, snapshot: () => snapshot(id, s) });
    if (s.closing) return reply(failure('close-in-progress'));
    if (s.copying) return reply(failure('copy-in-progress'));
    if (s.temporary && payload.operation === 'save') return reply(failure('temporary-not-persistable'));
    if (s.readOnly && ['save-original', 'import-image', 'rename-draft', 'format', 'source-edit', 'edit', 'save', 'undo', 'redo', 'check', 'create-test-copy', 'create-persistent-copy'].includes(payload.operation)) return reply(failure('read-only-document'));
    if (['inspect-linked-file','open-linked-file','reveal-linked-file','save-original', 'import-image', 'image-preview', 'rename-draft', 'open-confirmed-copy', 'reveal-confirmed-copy', 'format', 'source-edit', 'edit-copy', 'edit', 'save', 'close', 'undo', 'redo', 'create-test-copy', 'create-persistent-copy'].includes(payload.operation)) {
      if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) return reply(failure('invalid-revision'));
      if (payload.expectedRevision !== s.document.revision) return reply(failure('stale-revision'));
    }
    try {
      switch (payload.operation) {
        case 'inspect-linked-file': return reply(service.inspectLinkedFile(s.document));
        case 'open-linked-file': case 'reveal-linked-file': return followLinked(event,binding,id,s,payload);
        case 'save-original': return saveOriginal(event,binding,id,s,payload);
        case 'import-image': return importImage(event, binding, id, s, payload);
        case 'image-preview': return images ? {ok: true, sessionId: id, revision: s.document.revision, href: payload.href, dataUrl: images.preview(s.document, payload.href)} : failure('image-preview-unavailable');
        case 'rename-draft': {
          if (!s.temporary || !backups || s.document.blocked) return reply(failure('draft-name-unavailable'));
          if (payload.expectedLabel !== s.label) return reply(failure('stale-draft-name'));
          const label = normalizeDraftName(payload.label);
          if (!label) return reply(failure('invalid-draft-name'));
          const copy = service.getCopyState(s.document);
          if (copy && !copy.ok && copy.created !== false) return reply(failure('unresolved-save-state'));
          const result = backups.rename(s.document, label);
          if (authorizedBinding(event) !== binding || sessions.get(id) !== s) return failure('unknown-session');
          if (result.ok) s.label = label;
          return reply(result);
        }
        case 'open-confirmed-copy': case 'reveal-confirmed-copy': return followCopy(event, binding, id, s, payload);
        case 'edit-copy': {
          if (!s.readOnly) return reply(failure('read-only-source-required'));
          if (s.document.blocked) return reply(failure('conversion-blocked'));
          if (payload.expectedSha256 !== sourceHash(s.document.bytesForSave())) return reply(failure('source-hash-mismatch'));
          return newTemporary(binding, s, () => authorizedBinding(event) === binding && sessions.get(id) === s);
        }
        case 'create-persistent-copy': return persistentCopy(event, binding, id, s, payload);
        case 'create-test-copy': {
          if (!allowTestCopies || !s.temporary) return reply(failure('test-copy-unavailable'));
          s.copying = true;
          try {
            // Main chooses both directory (Service capability) and new filename.
            // Synchronous Service call is single-flight; never accept renderer source/path.
            const result = service.createIsolatedCopy(s.document, { name: `copy-${randomUUID()}.md`,
              expectedRevision: payload.expectedRevision, expectedSha256: payload.expectedSha256 });
            if (authorizedBinding(event) !== binding || sessions.get(id) !== s) {
              retained.add(s.document);
              return { ok: false, code: 'copy-session-invalidated', copy: copyState(s) };
            }
            return { ...reply(result), copy: copyState(s) };
          } finally { s.copying = false; }
        }
        case 'snapshot': return reply({ ok: true });
        case 'check': return reply(service.checkExternal(s.document));
        case 'save': return reply(service.save(s.document, { expectedRevision: payload.expectedRevision }));
        case 'close': {
          const state = service.getSaveState(s.document);
          if (s.document.dirty || state.durabilityUncertain || state.replacementUnverified) return reply(failure('unresolved-save-state'));
          const result = service.close(s.document); if (result.ok) invalidate(id, s); return { ok: result.ok, code: result.code };
        }
        case 'source-edit': {
          if (!s.temporary || s.readOnly || s.document.blocked) return reply(failure('source-edit-unavailable'));
          const before=s.document.text, mapped=sourceChange(before, payload);
          if (!mapped.ok) return reply(failure(mapped.code));
          projectSource(mapped.source); // Validate before mutation; unsupported syntax remains opaque.
          images?.validateChange(s.document, mapped.source);
          const result=s.document.edit({...mapped.change,expectedRevision:payload.expectedRevision});
          if (result.ok && s.document.text!==before) {
            s.undo.push({sourcePatch:true,before:sourceHash(before),after:sourceHash(mapped.source),
              undo:mapped.inverse,redo:mapped.change,undoSelection:{from:1,to:1},redoSelection:{from:1,to:1}});
            trimHistory(s.undo);
            s.redo=[];backups?.changed(s.document);
          }
          return reply(result);
        }
        case 'format': {
          if (s.document.blocked) return reply(failure('conversion-blocked'));
          if (typeof mapFormatEdit !== 'function') return reply(failure('format-unavailable'));
          const before = s.document.text;
          const command={action:payload.action,from:payload.from,to:payload.to};
          for(const key of ['label','href'])if(Object.hasOwn(payload,key))command[key]=payload[key];
          const mapped = mapFormatEdit(before, command);
          if (!mapped.ok) return reply(failure(mapped.code));
          if (payload.action === 'set-image') images?.validateChange(s.document, mapped.source);
          const result = s.document.edit({ ...mapped.change, expectedRevision: payload.expectedRevision });
          if (result.ok && s.document.text !== before) {
            // Exact inverses remain main-owned history; raw authoring has a separate validated operation.
            s.undo.push({ format: true, before: sourceHash(before), after: sourceHash(s.document.text),
              undo: mapped.inverseSource, redo: mapped.change,
              undoSelection: { from: payload.from, to: payload.to }, redoSelection: mapped.selection });
            trimHistory(s.undo);
            s.redo = []; backups?.changed(s.document);
          }
          return reply({ ...result, selection: mapped.selection });
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
            s.undo.push(mapped.inverseSource
              ? { sourcePatch: true, before: sourceHash(before), after: sourceHash(s.document.text),
                undo: mapped.inverseSource, redo: mapped.change,
                undoSelection: { from: change.from, to: change.to }, redoSelection: mapped.selection }
              : { before: sourceHash(before), after: sourceHash(s.document.text), redo: change, leaf: mapped.leaf, paragraphSeparator: mapped.paragraphSeparator || null,
                undo: mapped.inverse || { from: change.from, to: change.from + change.insert.length, insert: removed } });
            trimHistory(s.undo);
            s.redo = [];
            backups?.changed(s.document);
          }
          return reply(result);
        }
        case 'undo': case 'redo': {
          const undoing = payload.operation === 'undo', stack = undoing ? s.undo : s.redo;
          const entry = stack.at(-1);
          if (!entry) return reply(failure('history-empty'));
          const fromHash = undoing ? entry.after : entry.before, toHash = undoing ? entry.before : entry.after;
          if (sourceHash(s.document.text) !== fromHash) return reply(failure('history-diverged'));
          const change = entry[payload.operation], mapped = (entry.format || entry.sourcePatch)
            ? { ok: true, source: s.document.text.slice(0, change.from) + change.insert + s.document.text.slice(change.to),
              change, selection: entry[undoing ? 'undoSelection' : 'redoSelection'] }
            : mapTextEdit(s.document.text, change, entry.leaf, entry.paragraphSeparator);
          if (!mapped.ok || sourceHash(mapped.source) !== toHash) return reply(failure('history-diverged'));
          const result = s.document.edit({ ...mapped.change, expectedRevision: payload.expectedRevision });
          if (result.ok) {
            backups?.changed(s.document);
            stack.pop(); (undoing ? s.redo : s.undo).push(entry);
            result.selection = mapped.selection || { from: change.from + change.insert.length, to: change.from + change.insert.length };
          }
          return reply(result);
        }
      }
    } catch { return reply(failure('document-operation-failed')); }
  }
  return { grant, provision, request, revoke, flushDrafts: () => backups?.flushAll(), retainedCount: () => retained.size };
}
function registerDocumentIpc(ipcMain, manager) { ipcMain.handle(CHANNEL, (event, request) => manager.request(event, request)); }
module.exports = { CHANNEL, createDocumentSessions, registerDocumentIpc };
