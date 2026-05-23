/* Phase A.1 — Claude importer edge-case tests.
   Run focused: node --test test/session-import-claude-edge.test.js

   Covers regex skips, atomic-replace, mode bits, size cap, malformed JSON,
   and unknown top-level record types. Core/idempotency/security/render tests
   live in test/session-import-claude.test.js. Shared helpers live in
   test/session-import-claude-helpers.js.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs/promises');
const path     = require('node:path');

const { runImport } = require('../lib/session-importer-claude');

const {
  FIXED_NOW,
  FIXED_MTIME,
  PROJECT,
  MAX_BYTES,
  makeTempdir,
  rmrf,
  writeFixtureSession,
  buildBaseDirs,
} = require('./session-import-claude-helpers');

/* ─────────────────────── Stage A-CLAUDE-8 ─────────────────────── */
test('Stage A-CLAUDE-8 — project-dir names that fail PROJECT_NAME_RE are skipped', async () => {
  const tmp = await makeTempdir();
  try {
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    const badName = 'name with spaces';
    await writeFixtureSession(tmp, { projectName: badName });

    const summary = await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    assert.strictEqual(summary.imported, 0, 'bad-name project skipped');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-9 ─────────────────────── */
test('Stage A-CLAUDE-9 — session filenames that fail UUID regex are silently ignored', async () => {
  const tmp = await makeTempdir();
  try {
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    const projectDir = path.join(sourceRoot, PROJECT);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, 'not-a-uuid.jsonl'),
      '{"type":"user","message":{"content":"x"}}\n', 'utf8');
    await fs.writeFile(path.join(projectDir, 'README.md'), 'hi\n', 'utf8');

    const summary = await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    assert.strictEqual(summary.imported, 0);
  } finally {
    await rmrf(tmp);
  }
});

/* ────────────── Stage A-CLAUDE-ATOMIC-REPLACE ────────────── */
test('Stage A-CLAUDE-ATOMIC-REPLACE — pre-existing destination with different content is replaced atomically', async () => {
  const tmp = await makeTempdir();
  try {
    const { projectName, uuid } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const dest = path.join(outputBase, projectName, uuid + '.md');
    const before = await fs.readFile(dest, 'utf8');

    // Tamper destination with different content.
    await fs.writeFile(dest, 'TAMPERED\n', 'utf8');
    const tampered = await fs.readFile(dest, 'utf8');
    assert.strictEqual(tampered, 'TAMPERED\n');

    // Re-run should atomically replace.
    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const after = await fs.readFile(dest, 'utf8');
    assert.strictEqual(after, before, 're-run restores canonical content');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-11 ─────────────────────── */
test('Stage A-CLAUDE-11 — writeAtomically does not leave a tmp file under destination dir on success', async () => {
  const tmp = await makeTempdir();
  try {
    const { projectName, uuid } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const destDir = path.join(outputBase, projectName);
    const entries = await fs.readdir(destDir);
    const tmpEntries = entries.filter((n) => n.startsWith('.') && n.endsWith('.tmp'));
    assert.strictEqual(tmpEntries.length, 0, 'no leftover tmp files after success');
    assert.ok(entries.includes(uuid + '.md'), 'destination file present');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-12 ─────────────────────── */
test('Stage A-CLAUDE-12 — newly-created output directories are 0o700 and files are 0o600', async () => {
  const tmp = await makeTempdir();
  try {
    const { projectName, uuid } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });

    const dirStat  = await fs.stat(path.join(outputBase, projectName));
    const fileStat = await fs.stat(path.join(outputBase, projectName, uuid + '.md'));
    assert.strictEqual(dirStat.mode  & 0o777, 0o700, 'newly-created project dir is 0o700');
    assert.strictEqual(fileStat.mode & 0o777, 0o600, 'newly-created output file is 0o600');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-13 ─────────────────────── */
test('Stage A-CLAUDE-13 — pre-existing output directory is not chmod\'d on rerun', async () => {
  const tmp = await makeTempdir();
  try {
    const { projectName } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    // Pre-create with a non-default but valid mode.
    await fs.mkdir(path.join(outputBase, projectName), { recursive: true, mode: 0o750 });
    await fs.chmod(path.join(outputBase, projectName), 0o750);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });

    const dirStat = await fs.stat(path.join(outputBase, projectName));
    assert.strictEqual(dirStat.mode & 0o777, 0o750, 'pre-existing dir mode preserved');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-14 ─────────────────────── */
test('Stage A-CLAUDE-14 — source file > maxBytes is skipped, not errored, no partial output', async () => {
  const tmp = await makeTempdir();
  try {
    const { projectName, uuid } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    const filePath = path.join(sourceRoot, projectName, uuid + '.jsonl');
    const stat = await fs.stat(filePath);
    const tightCap = stat.size - 1;

    const summary = await runImport({ sourceRoot, outputBase, maxBytes: tightCap, now: FIXED_NOW });
    assert.strictEqual(summary.imported, 0);
    assert.strictEqual(summary.skipped, 1);
    assert.strictEqual(summary.errors, 0);

    const destPath = path.join(outputBase, projectName, uuid + '.md');
    let exists = false;
    try { await fs.access(destPath); exists = true; } catch { /* ok */ }
    assert.strictEqual(exists, false, 'no partial output for skipped session');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-15 ─────────────────────── */
test('Stage A-CLAUDE-15 — malformed JSON lines inside a session are silently skipped (per source tolerance)', async () => {
  const tmp = await makeTempdir();
  try {
    const records = [
      'NOT-VALID-JSON',
      JSON.stringify({ type: 'user',      message: { content: 'good' } }),
      '{"truncated":',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'reply' }] } }),
    ];
    const { projectName, uuid } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    const filePath = path.join(sourceRoot, projectName, uuid + '.jsonl');
    await fs.writeFile(filePath, records.join('\n') + '\n', 'utf8');
    await fs.utimes(filePath, FIXED_MTIME, FIXED_MTIME);

    const summary = await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    assert.strictEqual(summary.imported, 1, 'session still imported despite malformed lines');
    assert.strictEqual(summary.errors, 0);

    const out = await fs.readFile(path.join(outputBase, projectName, uuid + '.md'), 'utf8');
    assert.match(out, /## User\n\ngood/);
    assert.match(out, /## Assistant\n\nreply/);
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-16 ─────────────────────── */
test('Stage A-CLAUDE-16 — unknown top-level record types are silently dropped', async () => {
  const tmp = await makeTempdir();
  try {
    const records = [
      { type: 'system',           data: 'NOT-RENDERED' },
      { type: 'unknown-record',   data: 'STILL-NOT-RENDERED' },
      { type: 'user',             message: { content: 'visible-user' } },
      { type: 'file-history-snapshot', data: 'IGNORED' },
    ];
    const { projectName, uuid } = await writeFixtureSession(tmp, { records });
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const out = await fs.readFile(path.join(outputBase, projectName, uuid + '.md'), 'utf8');

    assert.ok(!/NOT-RENDERED/.test(out));
    assert.ok(!/STILL-NOT-RENDERED/.test(out));
    assert.ok(!/IGNORED/.test(out));
    assert.match(out, /## User\n\nvisible-user/);
  } finally {
    await rmrf(tmp);
  }
});
