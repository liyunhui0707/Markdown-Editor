/* Phase A — per-session processing for the Claude importer.
   Extracted from runImport (orchestrator) to keep it under the 300-line cap.
   Caller iterates project + session entries; this helper handles the
   per-file open → read → render → frontmatter → atomic-write chain.

   Returns a discriminated result:
     { result: 'imported',  dest: <abs path> }
     { result: 'skipped' }                       — over cap, symlink, non-file
     { result: 'errored' }                       — read/decode/write failure
     { result: 'ignored' }                       — filename doesn't match
                                                   SESSION_FILE_RE (caller
                                                   silently drops these)

   Critically: there is NO setImmediate yield inside this helper. The
   open → read → render → write chain remains contiguous to preserve
   atomicity. Yields happen between sessions in the orchestrator's loop. */

'use strict';

const fs   = require('node:fs/promises');
const path = require('node:path');

const { SESSION_FILE_RE } = require('./session-importer-claude-utils');
const {
  renderTranscript,
  extractEnrichment,
  buildFrontmatter,
} = require('./session-importer-claude-render');
const {
  readSessionFileSafe,
  writeAtomically,
} = require('./session-importer-claude-safe-read');

async function processOneSession({
  fileName,
  projReal,
  canonicalSourceRoot,
  canonicalProjOut,
  projectName,
  maxBytes,
  importStamp,
  includeRaw,
}) {
  if (!SESSION_FILE_RE.test(fileName)) return { result: 'ignored' };

  const fileAbs = path.join(projReal, fileName);
  let lst;
  try {
    lst = await fs.lstat(fileAbs);
  } catch {
    return { result: 'errored' };
  }
  if (lst.isSymbolicLink() || !lst.isFile()) {
    return { result: 'skipped' };
  }
  if (lst.size > maxBytes) {
    return { result: 'skipped' };
  }

  let buf;
  try {
    const res = await readSessionFileSafe(fileAbs, canonicalSourceRoot, maxBytes);
    buf = res.buf;
  } catch (err) {
    if (err && err.code === 'OVER_CAP') return { result: 'skipped' };
    return { result: 'errored' };
  }

  const content = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const uuid    = fileName.replace(/\.jsonl$/i, '');
  const dest    = path.join(canonicalProjOut, uuid + '.md');
  if (!dest.startsWith(canonicalProjOut + path.sep)) {
    return { result: 'errored' };
  }

  const enrichment = extractEnrichment(content, uuid);
  const fm = buildFrontmatter({
    projectName,
    uuid,
    importStamp,
    mtime:     lst.mtime,
    sizeBytes: lst.size,
    enrichment,
  });
  const body = renderTranscript(content, { includeRaw });

  try {
    await writeAtomically(dest, fm + body);
  } catch {
    return { result: 'errored' };
  }
  return { result: 'imported', dest };
}

module.exports = { processOneSession };
