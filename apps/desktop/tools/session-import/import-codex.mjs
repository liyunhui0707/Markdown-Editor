import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  expandHome,
  isForbiddenPath,
  assertSafeInt,
  validateAncestorChain,
} from './lib/output-root.mjs';
import { readSessionFileSafe, __testHooks } from './lib/safe-read.mjs';
import { writeAtomically } from './lib/atomic-write.mjs';
import {
  extractSessionId,
  renderTranscript,
  computeErroredCallIds,
  extractEnrichment,
  buildFrontmatter,
} from './lib/render-codex.mjs';
import {
  isPathUnder,
  validateAncestorChainCanonical,
  walkSourceTree,
} from './lib/codex-tree.mjs';

const __filename = fileURLToPath(import.meta.url);

export function parseRawFlag(v) {
  if (typeof v !== 'string') return false;
  const norm = v.trim().toLowerCase();
  return norm === '1' || norm === 'true';
}

export function parseMaxBytesEnv(raw) {
  if (raw === undefined || raw === '') return 52428800;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(
      `SESSION_IMPORT_MAX_BYTES must be an integer, got: ${JSON.stringify(raw)}`,
    );
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(
      `SESSION_IMPORT_MAX_BYTES must be a positive safe integer, got: ${n}`,
    );
  }
  return n;
}

export async function runCodexImport({
  sourceRoot,
  outputBase,
  maxBytes,
  now,
  includeRaw = false,
}) {
  if (__testHooks.getONOFOLLOW() === undefined) {
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

  const forbiddenCodexHome = path.dirname(canonicalSourceRoot);

  await validateAncestorChain(resolvedOutputBase);
  await validateAncestorChainCanonical(resolvedOutputBase, forbiddenCodexHome);

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
  if (isPathUnder(canonicalOutputBase, forbiddenCodexHome)) {
    throw new Error(
      `outputBase realpath resolves into Codex config tree: ${canonicalOutputBase}`,
    );
  }
  if (isForbiddenPath(canonicalOutputBase)) {
    throw new Error(`outputBase realpath is forbidden: ${canonicalOutputBase}`);
  }

  const walk = await walkSourceTree(canonicalSourceRoot);
  const summary = {
    imported: 0,
    skipped: walk.skipped,
    errors: walk.errors,
    candidates: walk.candidates.length,
    outputs: [],
    root: canonicalOutputBase,
  };

  for (const cand of walk.candidates) {
    if (cand.lst.size > maxBytes) {
      summary.skipped += 1;
      continue;
    }

    let buf;
    try {
      const res = await readSessionFileSafe(
        cand.fileAbs,
        canonicalSourceRoot,
        maxBytes,
      );
      buf = res.buf;
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
      await fs.mkdir(dayOutDir, { recursive: true, mode: 0o700 });
    } catch {
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
    const fm = buildFrontmatter({
      title: `codex/${pathSegments}/${sessionId}`,
      sessionId,
      pathSegments,
      lst: cand.lst,
      importStamp,
      enrichment,
      sourceLine: 'source: codex',
    });
    const body = renderTranscript(content, { includeRaw, erroredCallIds });

    try {
      await writeAtomically(dest, fm + body);
      summary.imported += 1;
      summary.outputs.push(dest);
    } catch {
      summary.errors += 1;
    }
  }

  return summary;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  (async () => {
    try {
      const env = process.env;
      const sourceRoot = path.join(os.homedir(), '.codex', 'sessions');
      const sessionRootRaw = env.SESSION_ROOT || '~/agent-sessions';
      const resolvedSessionRoot = path.resolve(expandHome(sessionRootRaw));
      if (isForbiddenPath(resolvedSessionRoot)) {
        throw new Error(`SESSION_ROOT must not be ${resolvedSessionRoot}`);
      }
      const outputBase = path.join(resolvedSessionRoot, 'codex');
      const maxBytes = parseMaxBytesEnv(env.SESSION_IMPORT_MAX_BYTES);
      const includeRaw = parseRawFlag(env.SESSION_IMPORT_RAW);
      const result = await runCodexImport({
        sourceRoot,
        outputBase,
        maxBytes,
        now: new Date(),
        includeRaw,
      });
      const where = result.root || outputBase;
      const note = result.note ? ` (${result.note})` : '';
      console.log(
        `Imported ${result.imported} (skipped ${result.skipped}, errors ${result.errors}) into ${where}${note}`,
      );
    } catch (err) {
      console.error(err && err.message ? err.message : String(err));
      process.exit(1);
    }
  })();
}
