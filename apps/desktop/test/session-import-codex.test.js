/* Phase A.2 — Codex importer core, idempotency, security, render, lstat-hardening tests.
   Run focused: node --test test/session-import-codex.test.js

   Mirrors Phase A.1's session-import-claude.test.js structure. Edge-case tests
   live in test/session-import-codex-edge.test.js. Shared helpers live in
   test/session-import-codex-helpers.js. Golden parity tests live in
   test/session-import-parity-codex.test.js. IPC extension tests in
   test/session-ipc.test.js.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs/promises');
const path     = require('node:path');

const { runImport } = require('../lib/session-importer-codex');
const { readSessionFileSafe } = require('../lib/session-importer-codex-safe-read');
const { renderTranscript, computeErroredCallIds } = require('../lib/session-importer-codex-render');

const {
  FIXED_NOW,
  VALID_UUID,
  ROLLOUT_BASE,
  ROLLOUT_OUT_FILE,
  YEAR,
  MONTH,
  DAY,
  MAX_BYTES,
  makeTempdir,
  rmrf,
  writeFixtureSession,
  buildBaseDirs,
} = require('./session-import-codex-helpers');

/* ─────────────────────── Stage A-CODEX-1 ─────────────────────── */
test('Stage A-CODEX-1 — runImport writes one cleaned .md per valid session into outputBase/<YYYY>/<MM>/<DD>/<rollout-basename>.md', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    const summary = await runImport({
      sourceRoot,
      outputBase,
      maxBytes: MAX_BYTES,
      now: FIXED_NOW,
      includeRaw: false,
    });

    assert.strictEqual(summary.imported, 1, 'one session imported');
    assert.strictEqual(summary.errors, 0);
    assert.strictEqual(summary.skipped, 0);

    const dest = path.join(outputBase, fixture.year, fixture.month, fixture.day, ROLLOUT_OUT_FILE);
    const stat = await fs.stat(dest);
    assert.ok(stat.isFile(), 'output is a regular file');

    const content = await fs.readFile(dest, 'utf8');
    assert.match(content, /^---\n/);
    assert.match(content, /\nagent: "codex"\n/);
    assert.match(content, new RegExp(`\\nsource_session_id: "${VALID_UUID}"\\n`));
    assert.match(content, /\nsource_path_segments: "2026\/05\/22"\n/);
    assert.match(content, /\nimported_at: "2026-05-23T00:00:00\.000Z"\n/);
    assert.match(content, /\nsource_mtime: "2026-05-22T12:00:00\.000Z"\n/);
    assert.match(content, /\nsource_bytes: "\d+"\n/);
    assert.match(content, /## User — 2026-05-22T11:00:00\.000Z\n\nhello/);
    assert.match(content, /## Assistant — 2026-05-22T11:00:01\.000Z\n\nhi back/);
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-2 ─────────────────────── */
test('Stage A-CODEX-2 — empty source root → importedCount=0; no per-date output subdir created', async () => {
  const tmp = await makeTempdir();
  try {
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    await fs.mkdir(sourceRoot, { recursive: true });

    const summary = await runImport({
      sourceRoot,
      outputBase,
      maxBytes: MAX_BYTES,
      now: FIXED_NOW,
    });

    assert.strictEqual(summary.imported, 0);
    assert.strictEqual(summary.errors, 0);
    assert.strictEqual(summary.skipped, 0);

    const outBaseEntries = await fs.readdir(outputBase);
    assert.deepStrictEqual(outBaseEntries, [], 'no per-date subdirs created');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-3 ─────────────────────── */
test('Stage A-CODEX-3 — rerun with same FIXED_NOW is byte-identical', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const dest = path.join(outputBase, fixture.year, fixture.month, fixture.day, ROLLOUT_OUT_FILE);
    const a = await fs.readFile(dest, 'utf8');

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const b = await fs.readFile(dest, 'utf8');

    assert.strictEqual(a, b, 'reruns with fixed now are byte-identical');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-4 ─────────────────────── */
test('Stage A-CODEX-4 — rerun with wall-clock now differs only in imported_at', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: new Date('2026-05-01T00:00:00.000Z') });
    const dest = path.join(outputBase, fixture.year, fixture.month, fixture.day, ROLLOUT_OUT_FILE);
    const a = await fs.readFile(dest, 'utf8');

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: new Date('2026-05-23T00:00:00.000Z') });
    const b = await fs.readFile(dest, 'utf8');

    const stripImported = (s) => s.replace(/\nimported_at: "[^"]+"\n/, '\n');
    assert.strictEqual(stripImported(a), stripImported(b), 'output identical except imported_at');
    assert.notStrictEqual(a, b, 'imported_at actually differs');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-5 ─────────────────────── */
test('Stage A-CODEX-5 — readSessionFileSafe opens with O_NOFOLLOW; symlink target throws', async () => {
  const tmp = await makeTempdir();
  try {
    const real = path.join(tmp, 'real.jsonl');
    await fs.writeFile(real, '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"x"}]}}\n', 'utf8');
    const link = path.join(tmp, 'link.jsonl');
    await fs.symlink(real, link);

    await assert.rejects(
      () => readSessionFileSafe(link, tmp, MAX_BYTES),
      (err) => err && err.code !== 'OVER_CAP',
    );
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-6 ─────────────────────── */
test('Stage A-CODEX-6 — readSessionFileSafe enforces canonicalSourceRoot containment', async () => {
  const tmp = await makeTempdir();
  try {
    const inside = path.join(tmp, 'inside');
    const outside = path.join(tmp, 'outside');
    await fs.mkdir(inside, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    const file = path.join(outside, 'x.jsonl');
    await fs.writeFile(file, '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"y"}]}}\n', 'utf8');

    await assert.rejects(
      () => readSessionFileSafe(file, inside, MAX_BYTES),
      /resolves outside source root/,
    );
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-7 ─────────────────────── */
test('Stage A-CODEX-7 — renderTranscript drops reasoning/token_count/agent_reasoning/base_instructions/encrypted_content by construction', async () => {
  const raw = [
    JSON.stringify({ type: 'session_meta', payload: { type: 'session_meta', base_instructions: 'SECRET-BASE-INSTRUCTIONS', cwd: '/home/x' } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', encrypted_content: 'FORBIDDEN-ENCRYPTED-CONTENT', summary: 'thinking trace' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', tokens: 12345 } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_reasoning', text: 'AGENT-REASONING-DROP' } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'reply' }] } }),
  ].join('\n') + '\n';

  const out = renderTranscript(raw, { includeRaw: false });

  assert.ok(!/SECRET-BASE-INSTRUCTIONS/.test(out),     'base_instructions dropped');
  assert.ok(!/FORBIDDEN-ENCRYPTED-CONTENT/.test(out),  'encrypted_content dropped');
  assert.ok(!/AGENT-REASONING-DROP/.test(out),         'agent_reasoning dropped');
  assert.ok(!/token_count/.test(out),                  'token_count dropped');
  assert.ok(!/reasoning/.test(out),                    'reasoning dropped');
  assert.match(out, /## User — 2026-01-01T00:00:00Z\n\nhello/);
  assert.match(out, /## Assistant — 2026-01-01T00:00:01Z\n\nreply/);
});

/* ─────────────── Stage A-CODEX-LSTAT-HARDEN-OUTPUT-BASE ─────────────── */
test('Stage A-CODEX-LSTAT-HARDEN-OUTPUT-BASE — symlink swap at outputBase mkdir → runImport rejects before walk; no /Users/ leak', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    // Sub-case 1: outputBase is a symlink after mkdir.
    const symlinkLst = {
      isSymbolicLink: () => true,
      isDirectory: () => false,
      isFile: () => false,
      mtime: new Date(),
      size: 0,
    };
    const fsOverrides = {
      lstat: async (p) => {
        // For outputBase, return our symlink mock; otherwise delegate to real fs.
        if (p === outputBase) return symlinkLst;
        return fs.lstat(p);
      },
    };

    let threwBefore = false;
    let pathLeaked = false;
    try {
      await runImport({
        sourceRoot,
        outputBase,
        maxBytes: MAX_BYTES,
        now: FIXED_NOW,
        fsOverrides,
      });
    } catch (err) {
      threwBefore = true;
      const msg = err && err.message ? err.message : '';
      if (/\/Users\//.test(msg)) pathLeaked = true;
    }
    assert.ok(threwBefore, 'runImport throws before walk on outputBase symlink swap');
    assert.ok(!pathLeaked, 'no /Users/ absolute path in thrown error message');

    // No output file should exist for the un-walked candidate.
    const dest = path.join(outputBase, fixture.year, fixture.month, fixture.day, ROLLOUT_OUT_FILE);
    let outExists = false;
    try { await fs.access(dest); outExists = true; } catch { /* ok */ }
    assert.strictEqual(outExists, false, 'no output written when outputBase is rejected');

    // Sub-case 2: outputBase is a regular file (not a directory) after mkdir.
    const fileLst = {
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
      mtime: new Date(),
      size: 0,
    };
    const fsOverrides2 = {
      lstat: async (p) => {
        if (p === outputBase) return fileLst;
        return fs.lstat(p);
      },
    };
    let threwBefore2 = false;
    try {
      await runImport({
        sourceRoot,
        outputBase,
        maxBytes: MAX_BYTES,
        now: FIXED_NOW,
        fsOverrides: fsOverrides2,
      });
    } catch {
      threwBefore2 = true;
    }
    assert.ok(threwBefore2, 'runImport throws when outputBase is not a directory after mkdir');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────── Stage A-CODEX-LSTAT-HARDEN-DAY-DIR ─────────────── */
test('Stage A-CODEX-LSTAT-HARDEN-DAY-DIR — symlink swap at day-dir mkdir → candidate errors; no output written; no /Users/ leak', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    const dayDir = path.join(outputBase, fixture.year, fixture.month, fixture.day);

    // Sub-case 1: day-dir is a symlink after mkdir.
    const symlinkLst = {
      isSymbolicLink: () => true,
      isDirectory: () => false,
      isFile: () => false,
      mtime: new Date(),
      size: 0,
    };
    const fsOverrides = {
      lstat: async (p) => {
        if (p === dayDir) return symlinkLst;
        return fs.lstat(p);
      },
    };

    const summary = await runImport({
      sourceRoot,
      outputBase,
      maxBytes: MAX_BYTES,
      now: FIXED_NOW,
      fsOverrides,
    });
    assert.strictEqual(summary.imported, 0, 'no candidate imported');
    assert.strictEqual(summary.errors, 1, 'candidate counted in summary.errors');

    // No output file at the dest.
    const dest = path.join(dayDir, ROLLOUT_OUT_FILE);
    let outExists = false;
    try { await fs.access(dest); outExists = true; } catch { /* ok */ }
    assert.strictEqual(outExists, false, 'no .md written for rejected day-dir');

    // Sub-case 2: day-dir is a regular file (not a directory) after mkdir.
    const fileLst = {
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
      mtime: new Date(),
      size: 0,
    };
    const fsOverrides2 = {
      lstat: async (p) => {
        if (p === dayDir) return fileLst;
        return fs.lstat(p);
      },
    };
    const summary2 = await runImport({
      sourceRoot,
      outputBase,
      maxBytes: MAX_BYTES,
      now: FIXED_NOW,
      fsOverrides: fsOverrides2,
    });
    assert.strictEqual(summary2.imported, 0);
    assert.strictEqual(summary2.errors, 1);
  } finally {
    await rmrf(tmp);
  }
});
