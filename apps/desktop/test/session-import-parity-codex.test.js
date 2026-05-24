/* Phase A.2 — golden parity tests against Local-Web-Server Codex reference outputs.

   For each fixture, we:
     1. Copy the fixture .jsonl into a tempdir-rooted fake ~/.codex/sessions/
        at <tmp>/fake-codex/sessions/<YYYY>/<MM>/<DD>/<rollout-basename>.jsonl
     2. utimes(FIXED_MTIME)  — deterministic source_mtime
     3. Call runImport(... now: FIXED_NOW Date instance ...)
     4. Read the produced .md
     5. Strict-equal compare against the reference .md generated from
        Local-Web-Server commit 4bb2eb3 (provenance recorded alongside).

   Because FIXED_MTIME, FIXED_NOW, the fixture bytes, the path segments, and
   the uuid are all pinned, every frontmatter field is deterministic — the
   comparison is FULL-BYTE-EQUAL with no excluded fields.

   Each parity test also asserts the reference does NOT contain forbidden
   allowlist tokens (reasoning, encrypted_content, token_count,
   agent_reasoning, base_instructions) that the fixture intentionally
   includes — proving the allowlist is exercised. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs/promises');
const path     = require('node:path');
const os       = require('node:os');

const { runImport } = require('../lib/session-importer-codex');

const FIXTURES_DIR = path.join(__dirname, 'session-viewer-fixtures');
const VALID_UUID         = '019c5f21-83e1-72c2-a129-83fa090f4c41';
const ROLLOUT_TIMESTAMP  = '2026-05-22T11-00-00';
const ROLLOUT_BASE       = `rollout-${ROLLOUT_TIMESTAMP}-${VALID_UUID}`;
const YEAR  = '2026';
const MONTH = '05';
const DAY   = '22';
const FIXED_MTIME  = new Date('2026-05-22T12:00:00.000Z');
const FIXED_NOW    = new Date('2026-05-23T00:00:00.000Z');
const MAX_BYTES    = 52428800;

async function makeTempdir() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'phase-a2-codex-parity-')));
}
async function rmrf(p) { try { await fs.rm(p, { recursive: true, force: true }); } catch {} }

async function runParity(fixtureBase) {
  const tmp = await makeTempdir();
  try {
    const sourceRoot = path.join(tmp, 'fake-codex', 'sessions');
    const outputBase = path.join(tmp, 'agent-sessions', 'codex');
    const dayDir     = path.join(sourceRoot, YEAR, MONTH, DAY);
    await fs.mkdir(dayDir, { recursive: true });

    const fixturePath = path.join(FIXTURES_DIR, fixtureBase + '.jsonl');
    const sessionFile = path.join(dayDir, ROLLOUT_BASE + '.jsonl');
    await fs.copyFile(fixturePath, sessionFile);
    await fs.utimes(sessionFile, FIXED_MTIME, FIXED_MTIME);

    await runImport({
      sourceRoot,
      outputBase,
      maxBytes:   MAX_BYTES,
      now:        FIXED_NOW,
      includeRaw: false,
    });

    const actual = await fs.readFile(
      path.join(outputBase, YEAR, MONTH, DAY, ROLLOUT_BASE + '.md'),
      'utf8',
    );
    const expected = await fs.readFile(
      path.join(FIXTURES_DIR, fixtureBase + '.expected.md'),
      'utf8',
    );
    return { actual, expected };
  } finally {
    await rmrf(tmp);
  }
}

/* ─────────────────── Stage A-CODEX-PARITY-1 ─────────────────── */
test('Stage A-CODEX-PARITY-1 — codex-minimal fixture: full-byte parity with Local-Web-Server reference', async () => {
  const { actual, expected } = await runParity('codex-minimal');
  assert.strictEqual(actual, expected,
    'Phase A.2 port output must be byte-identical to Local-Web-Server reference');
});

/* ─────────────────── Stage A-CODEX-PARITY-2 ─────────────────── */
test('Stage A-CODEX-PARITY-2 — codex-tool-calls fixture: full-byte parity + allowlist exercised + prepass-across-stream-order verified', async () => {
  const { actual, expected } = await runParity('codex-tool-calls');
  assert.strictEqual(actual, expected, 'tool-calls fixture parity');

  // Allowlist exercise: FIXTURE contains forbidden tokens; REFERENCE must not.
  const fixture = await fs.readFile(
    path.join(FIXTURES_DIR, 'codex-tool-calls.jsonl'), 'utf8');
  assert.match(fixture, /DROP-ME-BASE-INSTRUCTIONS/, 'fixture has base_instructions');
  assert.match(fixture, /DROP-ME-ENCRYPTED/,         'fixture has encrypted_content');
  assert.match(fixture, /DROP-ME-AGENT-REASONING/,   'fixture has agent_reasoning');
  assert.match(fixture, /token_count/,               'fixture has token_count');

  assert.doesNotMatch(expected, /DROP-ME-BASE-INSTRUCTIONS/, 'reference drops base_instructions');
  assert.doesNotMatch(expected, /DROP-ME-ENCRYPTED/,         'reference drops encrypted_content');
  assert.doesNotMatch(expected, /DROP-ME-AGENT-REASONING/,   'reference drops agent_reasoning');
  assert.doesNotMatch(expected, /token_count/,               'reference drops token_count');

  // Prepass-across-stream-order: the fixture places exec_command_end for
  // call_err AFTER its function_call_output. The reference's
  // "### Tool result (error)" proves the prepass works.
  assert.match(expected, /### Tool result \(error\)/, 'errored function_call_output flagged via prepass');
});
