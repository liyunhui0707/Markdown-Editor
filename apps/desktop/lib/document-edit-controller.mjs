import { mapFormatEdit } from './document-format-edit.mjs';
import { projectSource, mapTextEdit } from './document-source-map.mjs';

function transactionEdit(source, tr) {
  if (!tr.docChanged || tr.steps.length !== 1) return null;
  const step = tr.steps[0];
  const json = step.toJSON();
  if (json.stepType !== 'replace' || !step.slice) return null;
  let insert;
  if (!step.slice.openStart && !step.slice.openEnd && step.slice.content.content.every(node => node.isText)) {
    insert = step.slice.content.textBetween(0, step.slice.content.size, '', '');
  } else if (json.structure && step.from === step.to && step.slice.openStart === 1 && step.slice.openEnd === 1
      && step.slice.content.childCount === 2 && step.slice.content.content.every(node => node.type.name === 'paragraph' && !node.content.size)) {
    insert = '\n\n'; // Explicit paragraph split.
  } else if (step.slice.openStart === 1 && step.slice.openEnd === 1 && step.slice.content.childCount >= 2
      && step.slice.content.content.every(node => node.type.name === 'paragraph' && node.content.size
        && node.content.content.every(child => child.isText && !child.marks.length))) {
    insert = step.slice.content.content.map(node => node.textContent).join('\n\n');
  } else return null;
  const edit = { from: step.from, to: step.to, insert };
  const mapped = mapTextEdit(source, edit), schema = tr.doc.type.schema;
  if (!tr.before.eq(schema.nodeFromJSON(projectSource(source).doc)) || !mapped.ok
      || !tr.doc.eq(schema.nodeFromJSON(mapped.projection.doc))) return null;
  if (source.slice(mapped.change.from, mapped.change.to).length > 4096) return null;
  return { edit, source: mapped.source, structural: !!mapped.structural };
}

function composedEdit(before, after) {
  let from = 0, to = before.text.length, end = after.text.length;
  while (from < to && from < end && before.text[from] === after.text[from]) from++;
  while (to > from && end > from && before.text[to - 1] === after.text[end - 1]) { to--; end--; }
  const splits = (text, n) => /[\uD800-\uDBFF]/.test(text[n - 1] || '') && /[\uDC00-\uDFFF]/.test(text[n] || '');
  if (splits(before.text, from) || splits(after.text, from)) from--;
  if (splits(before.text, to) || splits(after.text, end)) { to++; end++; }
  if (to - from > 4096) return null;
  return { from: before.from + from, to: before.from + to, insert: after.text.slice(from, end) };
}

// A local optimistic view, not a second revision/history or persistence owner.
export function createEditController(initial, { send, onChange = () => {}, onReset = () => {}, recoveryRecords = [] }) {
  let confirmed = structuredClone(initial), source = initial.source, code = 'opened';
  const recoveries = recoveryRecords.map(r => {
    if (!r || r.sessionId !== initial.sessionId || !Number.isSafeInteger(r.id) || r.id < 1 || typeof r.source !== 'string'
        || r.source.length > 131072 || ('visibleText' in r && r.visibleText !== null
          && (typeof r.visibleText !== 'string' || r.visibleText.length > 131072))) throw Error('Invalid recovery record');
    return structuredClone(r);
  });
  if (new Set(recoveries.map(r => r.id)).size !== recoveries.length) throw Error('Duplicate recovery identity');
  let recoverySequence = Math.max(0, ...recoveries.map(r => r.id));
  let flight = false, locked = false, disposed = false, historyPending = false, composition = null, failures = 0;
  const queue = [], prepared = new WeakMap(), waiters = [];
  const valid = s => {
    if (!s || s.sessionId !== initial.sessionId || !Number.isSafeInteger(s.revision) || s.revision < 0
        || typeof s.source !== 'string' || typeof s.dirty !== 'boolean') return false;
    try { projectSource(s.source); return true; } catch { return false; }
  };
  const atCapacity = () => recoveries.length >= 16;
  function rememberDraft(reason) {
    if (source === confirmed.source || recoveries.some(r => r.source === source)) return null;
    const record = { id: ++recoverySequence, sessionId: initial.sessionId, source, reason,
      confirmedSource: confirmed.source, baseRevision: confirmed.revision, mainMatchesDraft: false };
    recoveries.push(record); return record;
  }
  function state() { return { confirmed, source, code, recoveryDraft: recoveries.at(-1)?.source || '',
    recoveryRecords: structuredClone(recoveries), pending: queue.length,
    composing: !!composition, compositionInvalid: !!composition?.invalid, recoveryCopyCapacity: atCapacity(), historyPending, locked: locked || disposed || atCapacity() }; }
  const notify = () => { if (!disposed) onChange(state()); };
  const settle = () => { if (!flight && !queue.length) for (const resolve of waiters.splice(0)) resolve(); };
  const idle = () => !flight && !queue.length ? Promise.resolve() : new Promise(resolve => waiters.push(resolve));
  async function reconcile(reply, reason) {
    const recovery = rememberDraft(reason); queue.length = 0; locked = true; failures++;
    let snapshot = reply?.snapshot;
    if (!valid(snapshot)) {
      try { snapshot = (await send('snapshot', { sessionId: initial.sessionId })).snapshot; } catch { /* outcome remains unknown */ }
    }
    if (disposed) return;
    if (valid(snapshot)) {
      confirmed = structuredClone(snapshot); locked = false;
      if (recovery) { recovery.observedMainRevision = snapshot.revision; recovery.mainMatchesDraft = recovery.source === snapshot.source; }
    }
    code = locked ? 'sync-unknown' : reason;
    if (composition) composition.invalid = true;
    else if (!locked) { source = confirmed.source; onReset(source); }
    notify();
  }
  async function pump() {
    if (flight || disposed || locked) return;
    flight = true;
    try {
      while (queue.length && !disposed) {
        const item = queue[0], revision = confirmed.revision;
        let reply;
        try { reply = await send('edit', { sessionId: initial.sessionId, expectedRevision: revision, ...item.edit }); }
        catch { await reconcile(null, 'ipc-failed'); break; }
        if (disposed) break;
        const next = reply?.snapshot, expected = revision + Number(item.source !== confirmed.source);
        if (!reply?.ok || !valid(next) || next.source !== item.source || next.revision !== expected) {
          await reconcile(reply?.ok ? null : reply, reply?.code || 'ack-mismatch'); break;
        }
        confirmed = structuredClone(next); queue.shift(); code = 'memory-edited'; notify();
      }
    } finally { flight = false; settle(); }
  }
  function prepare(tr) {
    if (!tr.docChanged) return true;
    if (disposed || locked || atCapacity() || historyPending || composition?.invalid || queue.length >= 64) {
      code = disposed ? 'controller-disposed' : locked ? 'sync-unknown' : atCapacity() ? 'recovery-capacity'
        : historyPending ? 'history-pending' : composition?.invalid ? 'composition-invalid' : 'edit-queue-full'; notify(); return false;
    }
    let mapped;
    try { mapped = transactionEdit(source, tr); } catch { mapped = null; }
    if (!mapped || (composition && mapped.structural)) {
      code = composition ? 'unsafe-composition' : 'unsafe-source-range';
      if (composition) composition.invalid = true;
      notify(); return false;
    }
    // A cleared list item has no source mark to inherit. Do not leave PM's
    // deleted bold mark behind and reject the user's next ordinary keystroke.
    const at = tr.selection.$from;
    if (mapped.edit.insert === '' && tr.selection.empty && at.parent.type.name === 'paragraph'
        && !at.parent.content.size && at.depth > 1 && at.node(at.depth - 1).type.name === 'listItem') tr.setStoredMarks(null);
    prepared.set(tr, mapped); return true;
  }
  function accept(tr) {
    const item = prepared.get(tr); prepared.delete(tr);
    if (!item || disposed) return;
    source = item.source;
    if (!composition) queue.push(item);
    code = composition ? 'composing-local' : 'edit-queued'; notify();
    if (!composition) void pump();
  }
  function beginComposition() {
    if (disposed || locked || atCapacity() || historyPending || composition) return false;
    composition = { base: source, invalid: false }; code = 'composing-local'; notify(); return true;
  }
  function endComposition() {
    if (!composition || disposed) return;
    const group = composition; composition = null;
    if (group.invalid || locked) {
      rememberDraft('unsafe-composition'); source = locked ? source : queue.length ? group.base : confirmed.source;
      code = locked ? 'sync-unknown' : 'unsafe-composition'; if (!locked) onReset(source); notify(); return;
    }
    if (source === group.base) { code = 'composition-cancelled'; notify(); return; }
    const before = projectSource(group.base).spans, after = projectSource(source).spans;
    const changed = before.filter((s, i) => s.text !== after[i]?.text);
    const span = changed[0], index = before.indexOf(span);
    const edit = before.length === after.length && changed.length === 1 && composedEdit(span, after[index]);
    const mapped = edit && mapTextEdit(group.base, edit);
    if (!mapped?.ok || mapped.source !== source) {
      rememberDraft('unsafe-composition'); source = group.base; code = 'unsafe-composition'; onReset(source); notify(); return;
    }
    queue.push({ edit, source }); code = 'composition-queued'; notify(); void pump();
  }
  async function history(operation) {
    if (!['undo', 'redo'].includes(operation) || disposed || locked || atCapacity() || composition || historyPending) return false;
    historyPending = true; const epoch = failures; notify();
    try {
      await idle(); if (disposed || locked || failures !== epoch) return false;
      const revision = confirmed.revision;
      let reply;
      try { reply = await send(operation, { sessionId: initial.sessionId, expectedRevision: revision }); }
      catch { await reconcile(null, 'ipc-failed'); return false; }
      if (disposed) return false;
      if (!valid(reply?.snapshot) || (!reply.ok && reply.code !== 'history-empty')
          || reply.snapshot.revision !== revision + Number(reply.ok)
          || (!reply.ok && reply.snapshot.source !== confirmed.source)) {
        await reconcile(reply?.ok ? null : reply, reply?.code || 'ack-mismatch'); return false;
      }
      confirmed = structuredClone(reply.snapshot); source = confirmed.source; code = reply.code || operation;
      if (reply.ok) onReset(source, reply.selection);
      return reply.ok;
    } finally { historyPending = false; notify(); }
  }
  async function format(command) {
    if (disposed || locked || atCapacity() || composition || historyPending || confirmed.readOnly) return false;
    historyPending = true; const epoch = failures; notify();
    try {
      await idle(); if (disposed || locked || failures !== epoch || recoveries.length) return false;
      const mapped = mapFormatEdit(source, command);
      if (!mapped.ok) { code = mapped.code; return false; }
      const revision = confirmed.revision;
      let reply;
      try { reply = await send('format', { sessionId: initial.sessionId, expectedRevision: revision, ...command }); }
      catch { await reconcile(null, 'ipc-failed'); return false; }
      if (disposed) return false;
      if (!reply?.ok) {
        if (valid(reply?.snapshot) && reply.snapshot.source === confirmed.source && reply.snapshot.revision === revision) { code = reply.code; return false; }
        await reconcile(reply, reply?.code || 'ack-mismatch'); return false;
      }
      if (!valid(reply.snapshot) || reply.snapshot.source !== mapped.source
          || reply.snapshot.revision !== revision + Number(mapped.source !== source)) {
        await reconcile(null, 'ack-mismatch'); return false;
      }
      confirmed = structuredClone(reply.snapshot); source = confirmed.source; code = 'formatted';
      onReset(source, mapped.selection); return true;
    } finally { historyPending = false; notify(); }
  }
  async function reload() {
    if (disposed || flight || queue.length || composition || historyPending) return false;
    historyPending = true; notify();
    try {
      const reply = await send('snapshot', { sessionId: initial.sessionId });
      if (disposed) return false;
      if (!reply.ok || !valid(reply.snapshot)) { locked = true; code = reply.code || 'sync-unknown'; notify(); return false; }
      confirmed = structuredClone(reply.snapshot); source = confirmed.source; locked = false; code = 'reloaded';
      onReset(source); notify(); return true;
    } catch { locked = true; code = 'sync-unknown'; return false; }
    finally { historyPending = false; notify(); }
  }
  function refresh(reply) {
    if (disposed || flight || queue.length || composition || historyPending) return;
    if (valid(reply?.snapshot)) {
      if (reply.snapshot.revision !== confirmed.revision || reply.snapshot.source !== confirmed.source) {
        void reconcile(null, 'stale-response'); return;
      }
      confirmed = structuredClone(reply.snapshot);
    } else locked = true;
    code = reply?.code || reply?.status || 'sync-unknown'; notify();
  }
  // Evidence only: no IPC, source reset, composition completion or lifecycle authority.
  function retainCompositionCopy(visibleText) {
    if (disposed) return { ok: false, code: 'controller-disposed' };
    if (!composition?.invalid && code !== 'unsafe-composition') return { ok: false, code: 'composition-copy-unavailable' };
    if (visibleText !== null && typeof visibleText !== 'string') return { ok: false, code: 'invalid-copy-input' };
    if (source.length > 131072 || (visibleText !== null && visibleText.length > 131072)) return { ok: false, code: 'copy-too-large' };
    const existing = recoveries.find(r => r.reason === 'composition-copy' && r.source === source
      && r.confirmedSource === confirmed.source && r.baseRevision === confirmed.revision && r.visibleText === visibleText);
    if (existing) return { ok: true, record: structuredClone(existing) };
    if (atCapacity()) return { ok: false, code: 'recovery-capacity' };
    // source may equal confirmed.source while IME text exists only in DOM or outside our reach.
    const record = { id: ++recoverySequence, sessionId: initial.sessionId, source, reason: 'composition-copy',
      confirmedSource: confirmed.source, baseRevision: confirmed.revision, mainMatchesDraft: source === confirmed.source,
      visibleText, visibleTextIncomplete: true };
    recoveries.push(record); notify();
    return { ok: true, record: structuredClone(record) };
  }
  function discardRecovery(id) {
    if (disposed || flight || queue.length || composition || historyPending) return false;
    const index = recoveries.findIndex(r => r.id === id);
    if (index < 0) return false;
    recoveries.splice(index, 1); code = 'recovery-discarded'; notify(); return true;
  }
  return { state, prepare, accept, beginComposition, endComposition, history, format, reload, refresh, idle, discardRecovery, retainCompositionCopy,
    dispose() { disposed = true; queue.length = 0; locked = true; for (const resolve of waiters.splice(0)) resolve(); } };
}
