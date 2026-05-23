/* Phase A.1 — main-process IPC layer for session imports.

   Exposes the 'import-claude' IPC channel (Phase A.2 adds 'import-codex').
   The handler:
     - Acquires a single-flight lock per kind; on contention returns
       { ok: false, reason: 'in-progress' } WITHOUT invoking the importer.
     - Calls runImport with HARDCODED paths derived from os.homedir():
       sourceRoot = ~/.claude/projects
       outputBase = ~/agent-sessions/claude-code
     - Hardcodes `includeRaw: false` so SESSION_IMPORT_RAW=1 in the env
       can NEVER defeat the allowlist-rendering guarantee via IPC.
     - Returns { ok: true, importedCount, skippedCount, errorCount, durationMs }
       on success.
     - Returns { ok: false, reason: <typed-code> } on failure. Typed reason
       codes only: 'in-progress', 'import-error', 'platform-unsupported'.
       NO err.message in response (importer errors may contain absolute
       paths; sanitization at the IPC boundary is binding).
     - Releases the lock in a finally block.

   `registerSessionIpc(ipcMain)` is the non-eager production entry point;
   it only wires handler functions. The O_NOFOLLOW runtime check lives
   inside runImport and fires on the first IPC call, returning
   'platform-unsupported' instead of failing at app startup.

   `createSessionHandlers({...})` is the internal test seam. Tests use it
   with mocked deps; never `require.cache` patching. */

'use strict';

const os   = require('node:os');
const path = require('node:path');

const O_NOFOLLOW_UNSUPPORTED_MSG =
  'symlink-safe reads unsupported on this platform: fs.constants.O_NOFOLLOW unavailable';

function isNoFollowUnsupportedError(err) {
  return !!(err && typeof err.message === 'string'
            && err.message.startsWith('symlink-safe reads unsupported on this platform'));
}

function buildClaudeHandler({ homedir, claudeImporter, lock, clock }) {
  return async function importClaude() {
    const token = lock.acquire('claude');
    if (token === null) {
      return { ok: false, reason: 'in-progress' };
    }
    const startedAt = Date.now();
    try {
      const home       = homedir();
      const sourceRoot = path.join(home, '.claude', 'projects');
      const outputBase = path.join(home, 'agent-sessions', 'claude-code');
      const summary    = await claudeImporter({
        sourceRoot,
        outputBase,
        maxBytes:   52428800,    // 50 MB default, matching Local-Web-Server
        now:        clock(),
        includeRaw: false,        // HARDCODED — never honors SESSION_IMPORT_RAW.
      });
      return {
        ok: true,
        importedCount: summary.imported,
        skippedCount:  summary.skipped,
        errorCount:    summary.errors,
        durationMs:    Date.now() - startedAt,
      };
    } catch (err) {
      if (isNoFollowUnsupportedError(err)) {
        return { ok: false, reason: 'platform-unsupported' };
      }
      // Sanitize: drop err.message entirely — importer errors may contain
      // absolute paths (e.g. 'output ancestor is a symlink: /Users/...').
      return { ok: false, reason: 'import-error' };
    } finally {
      lock.release(token);
    }
  };
}

function createSessionHandlers(opts = {}) {
  const homedir        = opts.homedir        || os.homedir;
  const claudeImporter = opts.claudeImporter || require('./session-importer-claude').runImport;
  const lock           = opts.lock           || require('./session-import-lock');
  const clock          = opts.clock          || (() => new Date());

  const importClaude = buildClaudeHandler({ homedir, claudeImporter, lock, clock });

  // Phase A.2 will add importCodex here.
  return { importClaude };
}

function registerSessionIpc(ipcMain) {
  // NON-EAGER: this function only wires handler closures. It does NOT
  // call runImport. The O_NOFOLLOW availability check lives inside
  // runImport and fires only when a handler is actually invoked, so
  // registerSessionIpc never throws at app startup on a platform missing
  // O_NOFOLLOW; the first IPC call returns 'platform-unsupported'.
  const handlers = createSessionHandlers();
  ipcMain.handle('import-claude', () => handlers.importClaude());
}

module.exports = {
  createSessionHandlers,
  registerSessionIpc,
  // Exposed for invariant tests / Phase A.2 reuse:
  O_NOFOLLOW_UNSUPPORTED_MSG,
  isNoFollowUnsupportedError,
};
