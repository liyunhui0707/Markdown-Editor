/* Phase A — Claude importer orchestrator.
   Ported from Local-Web-Server/tools/import-claude.js (runImport, lines
   334–620). ESM → CommonJS. CLI direct-run block intentionally dropped —
   Phase A has no CLI entry.

   The per-file processing chain (open → read → render → frontmatter →
   atomic-write) lives in ./session-importer-claude-session.js to keep
   this orchestrator under the 300-line file cap.

   O_NOFOLLOW availability check is RUNTIME (top of runImport, matching
   source line 335), NOT module init.

   Event-loop yielding (Codex umbrella finding #4): yieldEventLoop() is
   awaited between project iterations AND every 10 sessions within a
   project. Never invoked mid-file. */

'use strict';

const fs           = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path         = require('node:path');

const {
  PROJECT_NAME_RE,
  assertSafeInt,
  expandHome,
  isForbiddenPath,
} = require('./session-importer-claude-utils');

const {
  validateAncestorChain,
} = require('./session-importer-claude-safe-read');

const {
  processOneSession,
} = require('./session-importer-claude-session');

const YIELD_EVERY_N_SESSIONS = 10;

async function yieldEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function runImport({ sourceRoot, outputBase, maxBytes, now, includeRaw = false }) {
  if (fsConstants.O_NOFOLLOW === undefined) {
    throw new Error(
      'symlink-safe reads unsupported on this platform: fs.constants.O_NOFOLLOW unavailable',
    );
  }
  assertSafeInt('maxBytes', maxBytes, { min: 1, max: Number.MAX_SAFE_INTEGER });
  const importStamp = now instanceof Date ? now : new Date();

  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) {
    throw new Error('sourceRoot must be a non-empty string');
  }
  if (typeof outputBase !== 'string' || outputBase.length === 0) {
    throw new Error('outputBase must be a non-empty string');
  }

  const resolvedSourceRoot = path.resolve(expandHome(sourceRoot));
  if (isForbiddenPath(resolvedSourceRoot)) {
    throw new Error(`sourceRoot must not be ${resolvedSourceRoot}`);
  }
  const resolvedOutputBase = path.resolve(expandHome(outputBase));
  if (isForbiddenPath(resolvedOutputBase)) {
    throw new Error(`outputBase must not be ${resolvedOutputBase}`);
  }

  let srcLst;
  try {
    srcLst = await fs.lstat(resolvedSourceRoot);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return {
        imported: 0,
        skipped: 0,
        errors: 0,
        note: 'no-source',
        outputs: [],
        root: resolvedSourceRoot,
      };
    }
    throw err;
  }
  if (srcLst.isSymbolicLink()) {
    throw new Error('sourceRoot must not be a symlink');
  }
  if (!srcLst.isDirectory()) {
    throw new Error('sourceRoot must be a directory');
  }
  const canonicalSourceRoot = await fs.realpath(resolvedSourceRoot);
  if (isForbiddenPath(canonicalSourceRoot)) {
    throw new Error(
      `sourceRoot realpath resolves to forbidden path: ${canonicalSourceRoot}`,
    );
  }
  const sourceContainer = path.dirname(canonicalSourceRoot);
  const sourceContainerIsHidden = path.basename(sourceContainer).startsWith('.');

  if (sourceContainerIsHidden) {
    if (
      resolvedOutputBase === sourceContainer ||
      resolvedOutputBase.startsWith(sourceContainer + path.sep)
    ) {
      throw new Error('outputBase must not be inside source container');
    }
  }

  await validateAncestorChain(resolvedOutputBase);

  let outputBaseStat = null;
  try {
    outputBaseStat = await fs.lstat(resolvedOutputBase);
  } catch (err) {
    if (!(err && err.code === 'ENOENT')) throw err;
  }
  if (outputBaseStat) {
    if (outputBaseStat.isSymbolicLink()) {
      throw new Error('outputBase exists as a symlink');
    }
    if (!outputBaseStat.isDirectory()) {
      throw new Error('outputBase exists but is not a directory');
    }
  } else {
    await fs.mkdir(resolvedOutputBase, { recursive: true, mode: 0o700 });
  }

  const canonicalOutputBase = await fs.realpath(resolvedOutputBase);
  if (sourceContainerIsHidden) {
    if (
      canonicalOutputBase === sourceContainer ||
      canonicalOutputBase.startsWith(sourceContainer + path.sep)
    ) {
      throw new Error('outputBase realpath inside source container');
    }
  }
  if (isForbiddenPath(canonicalOutputBase)) {
    throw new Error(`outputBase realpath is forbidden: ${canonicalOutputBase}`);
  }

  const summary = {
    imported: 0,
    skipped: 0,
    errors: 0,
    outputs: [],
    root: canonicalOutputBase,
  };

  let projectEntries;
  try {
    projectEntries = await fs.readdir(canonicalSourceRoot);
  } catch (err) {
    summary.errors += 1;
    return summary;
  }
  projectEntries.sort();

  let projectIndex = 0;
  for (const projectName of projectEntries) {
    if (projectIndex > 0) await yieldEventLoop();
    projectIndex += 1;

    if (projectName.startsWith('.')) continue;
    if (!PROJECT_NAME_RE.test(projectName)) continue;

    const projectAbs = path.join(canonicalSourceRoot, projectName);
    let projLst;
    try {
      projLst = await fs.lstat(projectAbs);
    } catch {
      summary.errors += 1;
      continue;
    }
    if (projLst.isSymbolicLink() || !projLst.isDirectory()) continue;

    let projReal;
    try {
      projReal = await fs.realpath(projectAbs);
    } catch {
      summary.errors += 1;
      continue;
    }
    if (
      projReal !== canonicalSourceRoot &&
      !projReal.startsWith(canonicalSourceRoot + path.sep)
    ) {
      summary.errors += 1;
      continue;
    }

    const projOutPath = path.join(canonicalOutputBase, projectName);
    let projOutExists = false;
    try {
      const projOutLst = await fs.lstat(projOutPath);
      projOutExists = true;
      if (projOutLst.isSymbolicLink() || !projOutLst.isDirectory()) {
        summary.errors += 1;
        continue;
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        projOutExists = false;
      } else {
        summary.errors += 1;
        continue;
      }
    }
    if (!projOutExists) {
      try {
        await fs.mkdir(projOutPath, { mode: 0o700 });
      } catch {
        summary.errors += 1;
        continue;
      }
      // Defensive: re-lstat after mkdir to catch a TOCTOU symlink swap
      // between the failed pre-mkdir lstat and the mkdir success window.
      // Additive hardening over source; doesn't change happy-path bytes.
      try {
        const postLst = await fs.lstat(projOutPath);
        if (postLst.isSymbolicLink() || !postLst.isDirectory()) {
          summary.errors += 1;
          continue;
        }
      } catch {
        summary.errors += 1;
        continue;
      }
    }
    let canonicalProjOut;
    try {
      canonicalProjOut = await fs.realpath(projOutPath);
    } catch {
      summary.errors += 1;
      continue;
    }
    if (
      canonicalProjOut !== canonicalOutputBase &&
      !canonicalProjOut.startsWith(canonicalOutputBase + path.sep)
    ) {
      summary.errors += 1;
      continue;
    }

    let sessionEntries;
    try {
      sessionEntries = await fs.readdir(projReal);
    } catch {
      summary.errors += 1;
      continue;
    }
    sessionEntries.sort();

    let sessionIndex = 0;
    for (const fileName of sessionEntries) {
      // Yield BETWEEN files, never mid-file.
      if (sessionIndex > 0 && sessionIndex % YIELD_EVERY_N_SESSIONS === 0) {
        await yieldEventLoop();
      }
      sessionIndex += 1;

      const outcome = await processOneSession({
        fileName,
        projReal,
        canonicalSourceRoot,
        canonicalProjOut,
        projectName,
        maxBytes,
        importStamp,
        includeRaw,
      });

      if (outcome.result === 'imported') {
        summary.imported += 1;
        summary.outputs.push(outcome.dest);
      } else if (outcome.result === 'skipped') {
        summary.skipped += 1;
      } else if (outcome.result === 'errored') {
        summary.errors += 1;
      }
      // 'ignored' (non-session-shaped filenames) silently drops.
    }
  }

  return summary;
}

module.exports = {
  runImport,
  yieldEventLoop,
};
