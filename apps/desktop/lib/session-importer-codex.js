/* Phase A.2 — Codex importer orchestrator.
   Ported from Local-Web-Server/tools/import-codex.js (commit 4bb2eb3) lines
   657–855 (runImport). ESM → CommonJS. CLI direct-run block intentionally
   dropped — Phase A.2 has no CLI entry; the importer is reached only via
   main-process tests or, via IPC (Phase A.4 will expose preload key).

   Defensive lstat-after-mkdir HARDENING (additive over source) at the TWO
   mkdir sites:
     - outputBase create (mirrors source line 752): after mkdir, lstat;
       throw before walking candidates if symlink or not-directory.
     - per-day-dir create (mirrors source line 818): after mkdir, lstat;
       increment summary.errors and continue if symlink or not-directory.
   Happy-path bytes unchanged — verified by golden parity tests.

   Event-loop yielding: yieldEventLoop() awaited every 10 candidates BETWEEN
   walk.candidates iterations. NEVER mid-file. */

'use strict';

const fs           = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path         = require('node:path');

const {
  expandHome,
  isForbiddenPath,
  assertSafeInt,
  extractSessionId,
} = require('./session-importer-codex-utils');

const {
  isPathUnder,
  validateAncestorChainNoSymlink,
  validateAncestorChainCanonical,
  makeFsDeps,
  writeAtomically,
  readSessionFileSafe,
} = require('./session-importer-codex-safe-read');

const { walkSourceTree } = require('./session-importer-codex-walk');

const {
  renderTranscript,
  computeErroredCallIds,
  extractEnrichment,
  buildFrontmatter,
} = require('./session-importer-codex-render');

const YIELD_EVERY_N_CANDIDATES = 10;

async function yieldEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function runImport({
  sourceRoot,
  outputBase,
  maxBytes,
  now,
  includeRaw = false,
  fsOverrides,
}) {
  if (fsConstants.O_NOFOLLOW === undefined) {
    throw new Error(
      'symlink-safe reads unsupported on this platform: fs.constants.O_NOFOLLOW unavailable',
    );
  }
  assertSafeInt('maxBytes', maxBytes, { min: 1, max: Number.MAX_SAFE_INTEGER });
  const importStamp = now instanceof Date ? now : new Date();
  const _fs = makeFsDeps(fsOverrides);

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
    srcLst = await _fs.lstat(resolvedSourceRoot);
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

  const canonicalSourceRoot = await _fs.realpath(resolvedSourceRoot);
  if (isForbiddenPath(canonicalSourceRoot)) {
    throw new Error(
      `sourceRoot realpath resolves to forbidden path: ${canonicalSourceRoot}`,
    );
  }

  const forbiddenCodexHome = path.dirname(canonicalSourceRoot);

  await validateAncestorChainNoSymlink(resolvedOutputBase, _fs);
  await validateAncestorChainCanonical(resolvedOutputBase, forbiddenCodexHome, _fs);

  let outputBaseStat = null;
  try {
    outputBaseStat = await _fs.lstat(resolvedOutputBase);
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
    await _fs.mkdir(resolvedOutputBase, { recursive: true, mode: 0o700 });
    // HARDENING site 1 (additive over source): re-lstat after mkdir to catch
    // a TOCTOU symlink swap at the leaf, AND re-run the ancestor chain check
    // to catch an ancestor swap between the earlier validation and mkdir.
    // mkdir -p can follow an ancestor symlink swapped in after the initial
    // validation; the leaf lstat alone wouldn't catch that.
    const postLst = await _fs.lstat(resolvedOutputBase);
    if (postLst.isSymbolicLink() || !postLst.isDirectory()) {
      throw new Error('outputBase post-mkdir failed lstat directory check');
    }
    await validateAncestorChainNoSymlink(resolvedOutputBase, _fs);
  }

  const canonicalOutputBase = await _fs.realpath(resolvedOutputBase);
  if (isPathUnder(canonicalOutputBase, forbiddenCodexHome)) {
    throw new Error(
      `outputBase realpath resolves into Codex config tree: ${canonicalOutputBase}`,
    );
  }
  if (isForbiddenPath(canonicalOutputBase)) {
    throw new Error(`outputBase realpath is forbidden: ${canonicalOutputBase}`);
  }

  const walk = await walkSourceTree(canonicalSourceRoot, _fs);
  const summary = {
    imported: 0,
    skipped: walk.skipped,
    errors: walk.errors,
    candidates: walk.candidates.length,
    outputs: [],
    root: canonicalOutputBase,
  };

  let candidateIndex = 0;
  for (const cand of walk.candidates) {
    // Yield BETWEEN candidates every N. Skip first iteration's yield.
    if (candidateIndex > 0 && candidateIndex % YIELD_EVERY_N_CANDIDATES === 0) {
      await yieldEventLoop();
    }
    candidateIndex += 1;

    if (cand.lst.size > maxBytes) {
      summary.skipped += 1;
      continue;
    }

    let buf;
    let fdStat;
    try {
      const res = await readSessionFileSafe(
        cand.fileAbs,
        canonicalSourceRoot,
        maxBytes,
        { fs: fsOverrides },
      );
      buf = res.buf;
      fdStat = res.fdStat;
    } catch (err) {
      if (err && err.code === 'OVER_CAP') {
        summary.skipped += 1;
      } else {
        summary.errors += 1;
      }
      continue;
    }

    const content = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (content.trim().length === 0) {
      summary.skipped += 1;
      continue;
    }

    const sessionId = extractSessionId(cand.fileName);
    const dayOutDir = path.join(
      canonicalOutputBase,
      cand.year,
      cand.month,
      cand.day,
    );
    try {
      await _fs.mkdir(dayOutDir, { recursive: true, mode: 0o700 });
    } catch {
      summary.errors += 1;
      continue;
    }
    // HARDENING site 2 (additive over source): re-lstat after mkdir to catch
    // a TOCTOU symlink swap at the day-dir leaf, PLUS validate the ancestor
    // chain (year/month/day under canonicalOutputBase) for pre-existing
    // symlinks, PLUS realpath the dayOutDir and require it to remain under
    // canonicalOutputBase. The leaf-only lstat is insufficient on its own:
    // an attacker who placed a symlink at <outputBase>/2026 before
    // mkdir(2026/05/22, recursive) would have mkdir follow the symlink and
    // create <symlink-target>/05/22; the leaf is a real dir so lstat passes;
    // the lexical dest.startsWith check passes; writes land outside
    // canonicalOutputBase. The realpath containment check below catches that.
    try {
      const dayLst = await _fs.lstat(dayOutDir);
      if (dayLst.isSymbolicLink() || !dayLst.isDirectory()) {
        summary.errors += 1;
        continue;
      }
    } catch {
      summary.errors += 1;
      continue;
    }
    try {
      await validateAncestorChainNoSymlink(dayOutDir, _fs);
    } catch {
      summary.errors += 1;
      continue;
    }
    let canonicalDayOutDir;
    try {
      canonicalDayOutDir = await _fs.realpath(dayOutDir);
    } catch {
      summary.errors += 1;
      continue;
    }
    if (!isPathUnder(canonicalDayOutDir, canonicalOutputBase)) {
      summary.errors += 1;
      continue;
    }

    const baseName = cand.fileName.replace(/\.jsonl$/, '');
    const dest = path.join(dayOutDir, baseName + '.md');
    if (!dest.startsWith(canonicalOutputBase + path.sep)) {
      summary.errors += 1;
      continue;
    }

    const erroredCallIds = computeErroredCallIds(content);
    const enrichment = extractEnrichment(content);
    const pathSegments = `${cand.year}/${cand.month}/${cand.day}`;
    // Use fdStat (from the post-open file handle), NOT cand.lst (captured
    // during the earlier walk). If the file was modified between walk and
    // read, the imported content comes from the post-open file, so
    // source_mtime/source_bytes must describe the file actually read.
    const fm = buildFrontmatter({
      title: `codex/${pathSegments}/${sessionId}`,
      sessionId,
      pathSegments,
      lst: fdStat,
      importStamp,
      enrichment,
    });
    const body = renderTranscript(content, { includeRaw, erroredCallIds });

    try {
      await writeAtomically(dest, fm + body, _fs);
      summary.imported += 1;
      summary.outputs.push(dest);
    } catch {
      summary.errors += 1;
    }
  }

  return summary;
}

module.exports = {
  runImport,
  yieldEventLoop,
};
