// Stage S2 — sessionViewer:import IPC handler.
// Thin wrapper around the S1 importers at apps/desktop/tools/session-import/
// (which are .mjs). Importers are loaded via dynamic import() on first use
// in production; in tests they're injected through register(ipc, {importers}).
// Single-flight, per-agent outputBase, typed-reason failure response
// ({ok:false, reason:'no-vault'|'in-progress'|'platform-unsupported'|
// 'import-error'}; never throws across the IPC boundary; err.message is
// dropped here so absolute paths from the importers can't leak to the
// renderer — see test/session-viewer/refresh-ipc.test.js T1 for the
// sanitization invariant).

'use strict';

const path = require('node:path');
const os = require('node:os');

const CHANNEL = 'sessionViewer:import';
const CHATS_REL = 'Inbox/AI Chats';
const MAX_BYTES = 52428800;

const CLAUDE_ESM_REL =
  '../tools/session-import/import-claude.mjs';
const CODEX_ESM_REL =
  '../tools/session-import/import-codex.mjs';

// Predicate matches the well-known importer emit string verbatim. Source:
//   apps/desktop/tools/session-import/import-claude.mjs:204
//   apps/desktop/tools/session-import/import-codex.mjs:59
//   apps/desktop/tools/session-import/lib/safe-read.mjs:17
// If any of those throw sites is reworded, T2 in refresh-ipc.test.js must
// be updated alongside this prefix.
const O_NOFOLLOW_UNSUPPORTED_PREFIX =
  'symlink-safe reads unsupported on this platform';

function isNoFollowUnsupportedError(err) {
  return !!(
    err &&
    typeof err.message === 'string' &&
    err.message.startsWith(O_NOFOLLOW_UNSUPPORTED_PREFIX)
  );
}

function reasonForRejection(reason) {
  if (isNoFollowUnsupportedError(reason)) return 'platform-unsupported';
  return 'import-error';
}

let inFlight = false;

async function defaultImporters() {
  const [claudeMod, codexMod] = await Promise.all([
    import(new URL(CLAUDE_ESM_REL, `file://${__filename}`).href),
    import(new URL(CODEX_ESM_REL, `file://${__filename}`).href),
  ]);
  return {
    runClaudeImport: claudeMod.runClaudeImport,
    runCodexImport: codexMod.runCodexImport,
  };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

async function runImports({ vaultPath, importers }) {
  const sourceClaude = path.join(os.homedir(), '.claude', 'projects');
  const sourceCodex = path.join(os.homedir(), '.codex', 'sessions');
  const outputClaude = path.join(vaultPath, CHATS_REL, 'claude-code');
  const outputCodex = path.join(vaultPath, CHATS_REL, 'codex');
  const now = new Date();
  // allSettled (not Promise.all) so the single-flight lock stays held
  // until both importers finish, even if one rejects. Otherwise a
  // pending importer could still be writing when a second Refresh starts.
  const [claudeRes, codexRes] = await Promise.allSettled([
    importers.runClaudeImport({
      sourceRoot: sourceClaude,
      outputBase: outputClaude,
      maxBytes: MAX_BYTES,
      now,
    }),
    importers.runCodexImport({
      sourceRoot: sourceCodex,
      outputBase: outputCodex,
      maxBytes: MAX_BYTES,
      now,
    }),
  ]);
  if (claudeRes.status === 'rejected') {
    return { ok: false, reason: reasonForRejection(claudeRes.reason) };
  }
  if (codexRes.status === 'rejected') {
    return { ok: false, reason: reasonForRejection(codexRes.reason) };
  }
  return { ok: true, claude: claudeRes.value, codex: codexRes.value };
}

function register(ipc, options) {
  const importers = (options && options.importers) || null;
  ipc.handle(CHANNEL, async (_event, payload) => {
    const vaultPath = payload && payload.vaultPath;
    if (!isNonEmptyString(vaultPath)) {
      return { ok: false, reason: 'no-vault' };
    }
    if (inFlight) {
      return { ok: false, reason: 'in-progress' };
    }
    inFlight = true;
    try {
      const eff = importers || (await defaultImporters());
      return await runImports({ vaultPath, importers: eff });
    } catch (err) {
      // runImports itself returns reason-as-value; this catch is for the
      // dynamic-import path (defaultImporters()) failing.
      return { ok: false, reason: reasonForRejection(err) };
    } finally {
      inFlight = false;
    }
  });
}

module.exports = { register, CHANNEL };
