/* Phase A — single-flight import lock (in-memory, per-kind, main-process).

   Lives in the main process so the lock survives renderer reloads: while
   an import is running for a given kind, a fresh renderer attempting to
   trigger the same kind sees { ok: false, reason: 'in-progress' } until
   the original import finishes (or throws).

   Public surface:
     acquire(kind) → opaque token (Symbol) on success, null if already held.
     release(token) → void; safely no-ops on null / unknown token / double-release.

   Kinds are restricted to 'claude' and 'codex'; any other value throws. */

'use strict';

const VALID_KINDS = new Set(['claude', 'codex']);

const held = new Map(); // kind → Symbol token

function acquire(kind) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`session-import-lock: invalid kind: ${String(kind)}`);
  }
  if (held.has(kind)) return null;
  const token = Symbol(`session-import-lock:${kind}`);
  held.set(kind, token);
  return token;
}

function release(token) {
  if (token === null || token === undefined) return;
  if (typeof token !== 'symbol') return;
  for (const [kind, current] of held) {
    if (current === token) {
      held.delete(kind);
      return;
    }
  }
  // Unknown / stale token: silently no-op so double-release is safe.
}

module.exports = { acquire, release };
