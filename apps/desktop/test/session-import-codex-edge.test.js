/* Phase A.2 — Codex importer edge-case tests.
   Run focused: node --test test/session-import-codex-edge.test.js

   Covers: regex skips (walk-date, walk-rollout), double-ancestor defense
   (no-symlink + canonical), atomic-replace, mode bits, size cap,
   malformed JSON, unknown record types, errored-callid prepass (4 sub-cases
   incl. prepass-across-stream-order). Core/security/render/lstat-hardening
   tests live in test/session-import-codex.test.js. Shared helpers live in
   test/session-import-codex-helpers.js.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs/promises');
const path     = require('node:path');

const { runImport } = require('../lib/session-importer-codex');
const { computeErroredCallIds } = require('../lib/session-importer-codex-render');

const {
  FIXED_NOW,
  FIXED_MTIME,
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

/* ─────────────────────── Stage A-CODEX-WALK-DATE ─────────────────────── */
test('Stage A-CODEX-WALK-DATE — invalid year/month/day directory names are skipped', async () => {
  const tmp = await makeTempdir();
  try {
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    // Valid layout
    await writeFixtureSession(tmp);
    // Bad year: "20XY"
    await fs.mkdir(path.join(sourceRoot, '20XY', '05', '22'), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, '20XY', '05', '22', ROLLOUT_BASE + '.jsonl'),
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"x"}]}}\n');
    // Bad month: "13"
    await fs.mkdir(path.join(sourceRoot, '2026', '13', '22'), { recursive: true });
    // Bad day: "32"
    await fs.mkdir(path.join(sourceRoot, '2026', '05', '32'), { recursive: true });

    const summary = await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    assert.strictEqual(summary.imported, 1, 'only valid date-segment session imported');
    assert.ok(summary.skipped >= 1, 'at least one bad date segment skipped');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-WALK-ROLLOUT ─────────────────────── */
test('Stage A-CODEX-WALK-ROLLOUT — rollout filenames not matching ROLLOUT_FILE_RE are skipped', async () => {
  const tmp = await makeTempdir();
  try {
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    const dayDir = path.join(sourceRoot, YEAR, MONTH, DAY);
    await fs.mkdir(dayDir, { recursive: true });
    await fs.writeFile(path.join(dayDir, 'not-a-rollout.jsonl'),
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"x"}]}}\n');
    await fs.writeFile(path.join(dayDir, 'README.md'), 'hi\n');

    const summary = await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    assert.strictEqual(summary.imported, 0);
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-ANCESTOR-NOSYMLINK ─────────────────────── */
test('Stage A-CODEX-ANCESTOR-NOSYMLINK — output ancestor symlink refused before mkdir', async () => {
  const tmp = await makeTempdir();
  try {
    const { sourceRoot } = buildBaseDirs(tmp);
    await writeFixtureSession(tmp);
    // Create a symlink in the output ancestor chain.
    const realDir = path.join(tmp, 'real-output-parent');
    await fs.mkdir(realDir, { recursive: true });
    const linkPath = path.join(tmp, 'symlinked-output-parent');
    await fs.symlink(realDir, linkPath);
    const outputBase = path.join(linkPath, 'codex');

    await assert.rejects(
      () => runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW }),
      /output ancestor is a symlink/,
    );
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-ANCESTOR-CANONICAL ─────────────────────── */
test('Stage A-CODEX-ANCESTOR-CANONICAL — outputBase under dirname(realpath(sourceRoot)) refused', async () => {
  const tmp = await makeTempdir();
  try {
    const { sourceRoot } = buildBaseDirs(tmp);
    await writeFixtureSession(tmp);
    // sourceRoot's realpath dirname is <tmp>/fake-codex.
    // Place outputBase under <tmp>/fake-codex/output to trigger Defense B.
    const outputBase = path.join(tmp, 'fake-codex', 'output');

    await assert.rejects(
      () => runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW }),
      /resolves into Codex config tree/,
    );
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────── Stage A-CODEX-ATOMIC-REPLACE ─────────────── */
test('Stage A-CODEX-ATOMIC-REPLACE — pre-existing destination with different content is replaced atomically', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const dest = path.join(outputBase, fixture.year, fixture.month, fixture.day, ROLLOUT_OUT_FILE);
    const before = await fs.readFile(dest, 'utf8');

    await fs.writeFile(dest, 'TAMPERED\n', 'utf8');
    assert.strictEqual(await fs.readFile(dest, 'utf8'), 'TAMPERED\n');

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const after = await fs.readFile(dest, 'utf8');
    assert.strictEqual(after, before, 're-run restores canonical content');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-MODES ─────────────────────── */
test('Stage A-CODEX-MODES — newly-created directories are 0o700 and files are 0o600', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });

    const dayDir = path.join(outputBase, fixture.year, fixture.month, fixture.day);
    const dirStat = await fs.stat(dayDir);
    const fileStat = await fs.stat(path.join(dayDir, ROLLOUT_OUT_FILE));
    assert.strictEqual(dirStat.mode  & 0o777, 0o700, 'newly-created day dir is 0o700');
    assert.strictEqual(fileStat.mode & 0o777, 0o600, 'newly-created output file is 0o600');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-CAP ─────────────────────── */
test('Stage A-CODEX-CAP — source file > maxBytes is skipped, not errored, no partial output', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    const stat = await fs.stat(fixture.filePath);
    const tightCap = stat.size - 1;

    const summary = await runImport({ sourceRoot, outputBase, maxBytes: tightCap, now: FIXED_NOW });
    assert.strictEqual(summary.imported, 0);
    assert.strictEqual(summary.skipped, 1);
    assert.strictEqual(summary.errors, 0);

    const dest = path.join(outputBase, fixture.year, fixture.month, fixture.day, ROLLOUT_OUT_FILE);
    let exists = false;
    try { await fs.access(dest); exists = true; } catch { /* ok */ }
    assert.strictEqual(exists, false, 'no partial output for skipped session');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-MALFORMED ─────────────────────── */
test('Stage A-CODEX-MALFORMED — malformed JSON lines inside a session are silently skipped (per source tolerance)', async () => {
  const tmp = await makeTempdir();
  try {
    const records = [
      'NOT-VALID-JSON',
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'good' }] } }),
      '{"truncated":',
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'reply' }] } }),
    ];
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    await fs.writeFile(fixture.filePath, records.join('\n') + '\n', 'utf8');
    await fs.utimes(fixture.filePath, FIXED_MTIME, FIXED_MTIME);

    const summary = await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    assert.strictEqual(summary.imported, 1);
    assert.strictEqual(summary.errors, 0);

    const out = await fs.readFile(
      path.join(outputBase, fixture.year, fixture.month, fixture.day, ROLLOUT_OUT_FILE),
      'utf8',
    );
    assert.match(out, /## User\n\ngood/);
    assert.match(out, /## Assistant\n\nreply/);
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-UNKNOWN ─────────────────────── */
test('Stage A-CODEX-UNKNOWN — unknown record types are silently dropped', async () => {
  const tmp = await makeTempdir();
  try {
    const records = [
      { type: 'session_meta', payload: { type: 'session_meta', base_instructions: 'NOT-RENDERED-1' } },
      { type: 'turn_context', payload: { type: 'turn_context', summary: 'NOT-RENDERED-2' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'visible-user' }] } },
      { type: 'unknown-record-type', payload: { type: 'whatever', data: 'NOT-RENDERED-3' } },
      { type: 'event_msg', payload: { type: 'task_complete', data: 'NOT-RENDERED-4' } },
    ];
    const fixture = await writeFixtureSession(tmp, { records });
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    await runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW });
    const out = await fs.readFile(
      path.join(outputBase, fixture.year, fixture.month, fixture.day, ROLLOUT_OUT_FILE),
      'utf8',
    );

    assert.ok(!/NOT-RENDERED-1/.test(out));
    assert.ok(!/NOT-RENDERED-2/.test(out));
    assert.ok(!/NOT-RENDERED-3/.test(out));
    assert.ok(!/NOT-RENDERED-4/.test(out));
    assert.match(out, /## User\n\nvisible-user/);
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-PREPASS-EXEC ─────────────────────── */
test('Stage A-CODEX-PREPASS-EXEC — exec_command_end.exit_code != 0 flags call_id', () => {
  const records = [
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'X', output: 'ok' } }),
    JSON.stringify({ type: 'event_msg',     payload: { type: 'exec_command_end', call_id: 'X', exit_code: 1 } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'Y', output: 'ok' } }),
    JSON.stringify({ type: 'event_msg',     payload: { type: 'exec_command_end', call_id: 'Y', exit_code: 0 } }),
  ].join('\n');
  const errored = computeErroredCallIds(records);
  assert.ok(errored.has('X'), 'X flagged via exec_command_end.exit_code=1');
  assert.ok(!errored.has('Y'), 'Y not flagged (exit_code=0)');
});

/* ─────────────────────── Stage A-CODEX-PREPASS-PATCH ─────────────────────── */
test('Stage A-CODEX-PREPASS-PATCH — patch_apply_end.success === false flags call_id', () => {
  const records = [
    JSON.stringify({ type: 'event_msg', payload: { type: 'patch_apply_end', call_id: 'A', success: false } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'patch_apply_end', call_id: 'B', success: true } }),
  ].join('\n');
  const errored = computeErroredCallIds(records);
  assert.ok(errored.has('A'));
  assert.ok(!errored.has('B'));
});

/* ─────────────────────── Stage A-CODEX-PREPASS-OUTPUT-ERROR ─────────────────────── */
test('Stage A-CODEX-PREPASS-OUTPUT-ERROR — structured function_call_output.output.error flags call_id', () => {
  const records = [
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'C', output: { error: 'something failed' } } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'D', output: { error: '' } } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'E', output: 'plain-string-output' } }),
  ].join('\n');
  const errored = computeErroredCallIds(records);
  assert.ok(errored.has('C'),  'C flagged via non-empty output.error');
  assert.ok(!errored.has('D'), 'D not flagged (empty output.error)');
  assert.ok(!errored.has('E'), 'E not flagged (string output, no .error)');
});

/* ─────────────── Stage A-CODEX-LSTAT-HARDEN-OUTPUT-BASE-ANCESTOR ─────────────── */
test('Stage A-CODEX-LSTAT-HARDEN-OUTPUT-BASE-ANCESTOR — outputBase post-mkdir ancestor chain re-validated; symlinked grandparent caught', async () => {
  const tmp = await makeTempdir();
  try {
    const { sourceRoot } = buildBaseDirs(tmp);
    await writeFixtureSession(tmp);

    // outputBase = <tmp>/agent-sessions/codex.
    // We want to simulate: <tmp>/agent-sessions exists, and AFTER the initial
    // ancestor validation but BEFORE the mkdir, an attacker swaps the
    // grandparent <tmp>/agent-sessions to a symlink. The simplest stable
    // simulation: pre-plant <tmp>/agent-sessions as a symlink to a
    // real-elsewhere directory. The initial validateAncestorChainNoSymlink
    // (run before mkdir) catches it directly. The POST-mkdir ancestor re-run
    // is the belt for cases where the swap happens later, but the same
    // helper catches both paths — so this test pins that an outputBase under
    // a symlinked ancestor is refused. (Pre-validation already does this; the
    // post-mkdir re-run guarantees the property even if a TOCTOU race happens
    // between validation and mkdir.)
    const realDir = path.join(tmp, 'attacker-elsewhere');
    await fs.mkdir(realDir, { recursive: true });
    const symlinkedParent = path.join(tmp, 'agent-sessions');
    await fs.symlink(realDir, symlinkedParent);
    const outputBase = path.join(symlinkedParent, 'codex');

    await assert.rejects(
      () => runImport({ sourceRoot, outputBase, maxBytes: MAX_BYTES, now: FIXED_NOW }),
      /output ancestor is a symlink/,
      'symlinked grandparent of outputBase must be refused',
    );

    // Nothing should be written under realDir.
    const wouldBeDest = path.join(realDir, 'codex', '2026', '05', '22', 'rollout-anything.md');
    let written = false;
    try { await fs.access(wouldBeDest); written = true; } catch { /* ok */ }
    assert.strictEqual(written, false, 'no .md written under attacker redirect');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────── Stage A-CODEX-FDSTAT-PROVENANCE ─────────────── */
test('Stage A-CODEX-FDSTAT-PROVENANCE — frontmatter source_mtime/source_bytes come from post-open fdStat, not stale walk-time lst', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);
    const realStat = await fs.stat(fixture.filePath);
    const realSize = realStat.size;

    // Inject a fake lstat: when walkSourceTree calls lstat on the candidate
    // file, return a Stats with a wrong size. (mkdir/realpath/etc go through
    // real fs.) The orchestrator's fdStat from readSessionFileSafe will have
    // the REAL size; if the fix is correct, source_bytes in the frontmatter
    // will be realSize, NOT the fake size. Without the fix, source_bytes
    // would be the fake size.
    const FAKE_SIZE = 999999;
    const fsOverrides = {
      lstat: async (p) => {
        const real = await fs.lstat(p);
        if (p === fixture.filePath) {
          // Return a faked Stats object with the wrong size; keep mtime real.
          return {
            isSymbolicLink: () => real.isSymbolicLink(),
            isDirectory:   () => real.isDirectory(),
            isFile:        () => real.isFile(),
            mtime: real.mtime,
            size:  FAKE_SIZE,
            dev:   real.dev,
            ino:   real.ino,
          };
        }
        return real;
      },
    };

    const summary = await runImport({
      sourceRoot,
      outputBase,
      maxBytes: MAX_BYTES,
      now: FIXED_NOW,
      fsOverrides,
    });
    assert.strictEqual(summary.imported, 1);

    const dest = path.join(outputBase, fixture.year, fixture.month, fixture.day,
      ROLLOUT_BASE + '.md');
    const content = await fs.readFile(dest, 'utf8');

    // Frontmatter must contain the REAL size (from fdStat), not the fake.
    assert.match(content, new RegExp(`\\nsource_bytes: "${realSize}"\\n`),
      'source_bytes from fdStat (post-open), not walk-time stale lst');
    assert.ok(!new RegExp(`source_bytes: "${FAKE_SIZE}"`).test(content),
      'fake walk-time size MUST NOT appear in frontmatter');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────── Stage A-CODEX-LSTAT-HARDEN-ANCESTOR-SYMLINK ─────────────── */
test('Stage A-CODEX-LSTAT-HARDEN-ANCESTOR-SYMLINK — pre-existing year-component symlink under outputBase → candidate errors; no .md written at redirect target', async () => {
  const tmp = await makeTempdir();
  try {
    const fixture = await writeFixtureSession(tmp);
    const { sourceRoot, outputBase } = buildBaseDirs(tmp);

    // Create outputBase manually so we can pre-plant a symlink at YEAR.
    await fs.mkdir(outputBase, { recursive: true, mode: 0o700 });

    // Attacker-controlled "redirect target" — a real dir somewhere else under
    // tempdir (NOT under outputBase).
    const redirectTarget = path.join(tmp, 'attacker-redirect');
    await fs.mkdir(redirectTarget, { recursive: true });

    // Plant a symlink at <outputBase>/<YEAR> pointing to the redirect target.
    const yearLink = path.join(outputBase, fixture.year);
    await fs.symlink(redirectTarget, yearLink);

    const summary = await runImport({
      sourceRoot,
      outputBase,
      maxBytes: MAX_BYTES,
      now: FIXED_NOW,
    });

    // The candidate must be counted in summary.errors (not imported).
    assert.strictEqual(summary.imported, 0, 'no candidate imported when year-component is a symlink');
    assert.strictEqual(summary.errors, 1, 'candidate counted in summary.errors');

    // The .md file MUST NOT have been written under the attacker-controlled
    // redirect target. Verify nothing was written at the would-be path.
    const redirectedDest = path.join(redirectTarget, fixture.month, fixture.day, ROLLOUT_OUT_FILE);
    let writtenAtRedirect = false;
    try { await fs.access(redirectedDest); writtenAtRedirect = true; } catch { /* ok */ }
    assert.strictEqual(writtenAtRedirect, false,
      'no .md written under attacker-controlled redirect target');
  } finally {
    await rmrf(tmp);
  }
});

/* ─────────────────────── Stage A-CODEX-PREPASS-ORDER ─────────────────────── */
test('Stage A-CODEX-PREPASS-ORDER — error signal AFTER function_call_output still flags correctly (order-independent)', () => {
  // function_call_output appears FIRST; the exec_command_end with exit_code=1
  // appears SEVERAL lines LATER. The prepass must scan the whole file before
  // emitting the (error) marker.
  const records = [
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'LATE', output: 'preceding error signal' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'intervening' }] } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'more intervening' }] } }),
    JSON.stringify({ type: 'event_msg',     payload: { type: 'exec_command_end', call_id: 'LATE', exit_code: 7 } }),
  ].join('\n');
  const errored = computeErroredCallIds(records);
  assert.ok(errored.has('LATE'), 'LATE flagged despite signal appearing AFTER output record');
});
