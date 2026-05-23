/* Phase A.1 — golden parity tests against Local-Web-Server reference outputs.

   For each fixture, we:
     1. Copy the fixture .jsonl into a tempdir-rooted fake ~/.claude/projects/
     2. utimes(FIXED_MTIME)  — deterministic source_mtime
     3. Call runImport(... now: new Date(FIXED_NOW) ...)
     4. Read the produced .md
     5. Strict-equal compare against the reference .md generated from
        Local-Web-Server (provenance recorded alongside each reference).

   Because FIXED_MTIME, FIXED_NOW, the fixture bytes, the project name, and
   the uuid are all pinned, every frontmatter field including imported_at is
   deterministic — the comparison is FULL-BYTE-EQUAL with no excluded fields.

   Each parity test also asserts the reference does NOT contain forbidden
   allowlist tokens (thinking, usage, requestId, etc.) that the fixture
   intentionally includes — proving the allowlist is exercised by the port,
   not just declared. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs/promises');
const path     = require('node:path');
const os       = require('node:os');

const { runImport } = require('../lib/session-importer-claude');

const FIXTURES_DIR = path.join(__dirname, 'session-viewer-fixtures');
const PROJECT      = '-Users-test-myproject';
const UUID         = '12345678-1234-1234-1234-123456789012';
const FIXED_MTIME  = new Date('2026-05-22T12:00:00.000Z');
const FIXED_NOW    = new Date('2026-05-23T00:00:00.000Z');
const MAX_BYTES    = 52428800;

async function makeTempdir() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'phase-a-parity-')));
}
async function rmrf(p) { try { await fs.rm(p, { recursive: true, force: true }); } catch {} }

async function runParity(fixtureBase) {
  const tmp = await makeTempdir();
  try {
    const sourceRoot = path.join(tmp, 'src');
    const outputBase = path.join(tmp, 'out', 'claude-code');
    const projDir    = path.join(sourceRoot, PROJECT);
    await fs.mkdir(projDir, { recursive: true });

    const fixturePath = path.join(FIXTURES_DIR, fixtureBase + '.jsonl');
    const sessionFile = path.join(projDir, UUID + '.jsonl');
    await fs.copyFile(fixturePath, sessionFile);
    await fs.utimes(sessionFile, FIXED_MTIME, FIXED_MTIME);

    await runImport({
      sourceRoot,
      outputBase,
      maxBytes:   MAX_BYTES,
      now:        FIXED_NOW,
      includeRaw: false,
    });

    const actual   = await fs.readFile(path.join(outputBase, PROJECT, UUID + '.md'), 'utf8');
    const expected = await fs.readFile(path.join(FIXTURES_DIR, fixtureBase + '.expected.md'), 'utf8');
    return { actual, expected };
  } finally {
    await rmrf(tmp);
  }
}

/* ─────────────────── Stage A-CLAUDE-PARITY-1 ─────────────────── */
test('Stage A-CLAUDE-PARITY-1 — claude-minimal fixture: full-byte parity with Local-Web-Server reference', async () => {
  const { actual, expected } = await runParity('claude-minimal');
  assert.strictEqual(actual, expected,
    'Phase A.1 port output must be byte-identical to Local-Web-Server reference');
});

/* ─────────────────── Stage A-CLAUDE-PARITY-2 ─────────────────── */
test('Stage A-CLAUDE-PARITY-2 — claude-tool-calls fixture: full-byte parity + allowlist exercised', async () => {
  const { actual, expected } = await runParity('claude-tool-calls');
  assert.strictEqual(actual, expected, 'tool-calls fixture parity');

  // Allowlist exercise: the FIXTURE contains these forbidden tokens; the
  // REFERENCE must not. Pin so future drift in the allowlist is loud.
  const fixture = await fs.readFile(
    path.join(FIXTURES_DIR, 'claude-tool-calls.jsonl'), 'utf8');
  assert.match(fixture,   /DROP-ME-THINKING/, 'fixture has thinking field');
  assert.match(fixture,   /req_FORBIDDEN_1/,  'fixture has requestId field');
  assert.match(fixture,   /input_tokens/,     'fixture has usage field');

  assert.doesNotMatch(expected, /DROP-ME-THINKING/, 'reference drops thinking');
  assert.doesNotMatch(expected, /req_FORBIDDEN/,   'reference drops requestId');
  assert.doesNotMatch(expected, /input_tokens/,    'reference drops usage');
  assert.doesNotMatch(expected, /output_tokens/,   'reference drops usage');
});
