/* Phase A.1 — Claude importer core, idempotency, security, render tests.
   Run focused: node --test test/session-import-claude.test.js

   Edge-case tests (regex skips, atomic-replace, mode bits, size cap,
   malformed JSON, unknown record types) live in
   test/session-import-claude-edge.test.js. Shared helpers live in
   test/session-import-claude-helpers.js.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs/promises');
const path     = require('node:path');

const { runImport } = require('../lib/session-importer-claude');
const { readSessionFileSafe } = require('../lib/session-importer-claude-safe-read');
const { renderTranscript } = require('../lib/session-importer-claude-render');

const {
  FIXED_NOW,
  MAX_BYTES,
  makeTempdir,
  rmrf,
  writeFixtureSession,
  buildBaseDirs,
} = require('./session-import-claude-helpers');

/* ─────────────────────── Stage A-CLAUDE-1 ─────────────────────── */
test('Stage A-CLAUDE-1 — runImport writes one cleaned .md per valid session into outputBase/<projectName>/<uuid>.md', async () => {
  const tmp = await makeTempdir();
  try {
    const { projectName, uuid } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    const summary = await runImport({
      sourceRoot,
      outputBase,
      maxBytes: MAX_BYTES,
      now: FIXED_NOW,
      includeRaw: false,
    });

    assert.strictEqual(summary.imported, 1);
    assert.strictEqual(summary.errors, 0);
    assert.strictEqual(summary.skipped, 0);

    const dest = path.join(outputBase, projectName, uuid + '.md');
    const stat = await fs.stat(dest);
    assert.ok(stat.isFile(), 'output is a regular file');

    const content = await fs.readFile(dest, 'utf8');
    assert.match(content, /^---\n/);
    assert.match(content, /\nagent: "claude-code"\n/);
    assert.match(content, new RegExp(`\\nsource_session_id: "${uuid}"\\n`));
    assert.match(content, new RegExp(`\\nsource_project_dir: "${projectName}"\\n`));
    assert.match(content, /\nimported_at: "2026-05-23T00:00:00\.000Z"\n/);
    assert.match(content, /\nsource_mtime: "2026-05-22T12:00:00\.000Z"\n/);
    assert.match(content, /\nsource_bytes: "\d+"\n/);
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-2 ─────────────────────── */
test('Stage A-CLAUDE-2 — empty source root → importedCount=0; no per-project output subdir created', async () => {
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

    // runImport DOES create outputBase up-front (mode 0o700), but no per-project
    // subdir should be created when there are no source projects to import.
    const outBaseEntries = await fs.readdir(outputBase);
    assert.deepStrictEqual(outBaseEntries, [], 'no per-project subdirs created');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-3 ─────────────────────── */
test('Stage A-CLAUDE-3 — rerun with same FIXED_NOW is byte-identical', async () => {
  const tmp = await makeTempdir();
  try {
    const { projectName, uuid } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const dest = path.join(outputBase, projectName, uuid + '.md');
    const a = await fs.readFile(dest, 'utf8');

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const b = await fs.readFile(dest, 'utf8');

    assert.strictEqual(a, b, 'reruns with fixed now are byte-identical');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-4 ─────────────────────── */
test('Stage A-CLAUDE-4 — rerun with wall-clock now differs only in imported_at', async () => {
  const tmp = await makeTempdir();
  try {
    const { projectName, uuid } = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: new Date('2026-05-01T00:00:00.000Z') });
    const dest = path.join(outputBase, projectName, uuid + '.md');
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

/* ─────────────────────── Stage A-CLAUDE-5 ─────────────────────── */
test('Stage A-CLAUDE-5 — readSessionFileSafe opens with O_NOFOLLOW; symlink target throws', async () => {
  const tmp = await makeTempdir();
  try {
    const real = path.join(tmp, 'real.jsonl');
    await fs.writeFile(real, '{"type":"user","message":{"content":"x"}}\n', 'utf8');
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

/* ─────────────────────── Stage A-CLAUDE-6 ─────────────────────── */
test('Stage A-CLAUDE-6 — readSessionFileSafe enforces canonicalSourceRoot containment', async () => {
  const tmp = await makeTempdir();
  try {
    const inside = path.join(tmp, 'inside');
    const outside = path.join(tmp, 'outside');
    await fs.mkdir(inside, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    const file = path.join(outside, 'x.jsonl');
    await fs.writeFile(file, '{"type":"user","message":{"content":"y"}}\n', 'utf8');

    await assert.rejects(
      () => readSessionFileSafe(file, inside, MAX_BYTES),
      /resolves outside source root/,
    );
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CLAUDE-7 ─────────────────────── */
test('Stage A-CLAUDE-7 — renderTranscript drops thinking/usage/requestId/model fields by construction', async () => {
  const raw = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: { content: [{ type: 'text', text: 'hello' }] },
      thinking: 'SECRET-THINKING-TRACE',
      usage: { input_tokens: 12, output_tokens: 7 },
      requestId: 'req_FORBIDDEN',
      model: 'claude-DROP-ME',
      cache_read_tokens: 99,
      service_tier: 'standard',
    }),
  ].join('\n') + '\n';

  const out = renderTranscript(raw, { includeRaw: false });

  assert.ok(!/SECRET-THINKING-TRACE/.test(out), 'thinking field dropped');
  assert.ok(!/req_FORBIDDEN/.test(out),         'requestId dropped');
  assert.ok(!/claude-DROP-ME/.test(out),        'model dropped');
  assert.ok(!/input_tokens/.test(out),          'usage dropped');
  assert.ok(!/cache_read_tokens/.test(out),     'cache tokens dropped');
  assert.ok(!/service_tier/.test(out),          'service tier dropped');
  assert.match(out, /## Assistant — 2026-01-01T00:00:00Z\n\nhello/);
});

/* Note: Stage A-CLAUDE-17 (O_NOFOLLOW availability) is a source-shape
   invariant in test/session-a-invariants.test.js (Phase A.3 / future). */
