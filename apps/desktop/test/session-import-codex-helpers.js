/* Phase A.2 — shared test helpers for the Codex importer tests.
   Not a *.test.js file, so the npm-test glob does not pick it up. */

'use strict';

const fs   = require('node:fs/promises');
const path = require('node:path');
const os   = require('node:os');

const FIXED_NOW          = new Date('2026-05-23T00:00:00.000Z');
const FIXED_MTIME        = new Date('2026-05-22T12:00:00.000Z');
const VALID_UUID         = '019c5f21-83e1-72c2-a129-83fa090f4c41';
const ROLLOUT_TIMESTAMP  = '2026-05-22T11-00-00';
const ROLLOUT_BASE       = `rollout-${ROLLOUT_TIMESTAMP}-${VALID_UUID}`;
const ROLLOUT_FILE       = ROLLOUT_BASE + '.jsonl';
const ROLLOUT_OUT_FILE   = ROLLOUT_BASE + '.md';
const YEAR               = '2026';
const MONTH              = '05';
const DAY                = '22';
const MAX_BYTES          = 10485760;

async function makeTempdir() {
  // realpath the tmpdir: on macOS, os.tmpdir() is under /var which is a
  // symlink to /private/var. The importer's validateAncestorChainNoSymlink
  // refuses output under any symlink ancestor, so tests must use the
  // canonical /private/var path.
  const t = await fs.mkdtemp(path.join(os.tmpdir(), 'phase-a2-codex-'));
  return fs.realpath(t);
}

async function rmrf(p) {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function writeFixtureSession(tempRoot, opts = {}) {
  const year    = opts.year  || YEAR;
  const month   = opts.month || MONTH;
  const day     = opts.day   || DAY;
  const baseName = opts.baseName || ROLLOUT_BASE;
  const fileName = baseName + '.jsonl';
  const uuid     = opts.uuid || VALID_UUID;
  const records = opts.records || [
    { type: 'response_item', timestamp: '2026-05-22T11:00:00.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
    { type: 'response_item', timestamp: '2026-05-22T11:00:01.000Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi back' }] } },
  ];

  const dayDir = path.join(tempRoot, 'fake-codex', 'sessions', year, month, day);
  await fs.mkdir(dayDir, { recursive: true });
  const filePath = path.join(dayDir, fileName);
  const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await fs.writeFile(filePath, body, 'utf8');
  await fs.utimes(filePath, FIXED_MTIME, FIXED_MTIME);
  return { year, month, day, fileName, baseName, uuid, filePath };
}

function buildBaseDirs(tempRoot) {
  // Source root nested under <tempRoot>/fake-codex/ so the importer's
  // forbiddenCodexHome = dirname(realpath(sourceRoot)) = <tempRoot>/fake-codex,
  // and the output base at <tempRoot>/agent-sessions/codex is NOT under it.
  // Matches Local-Web-Server's documented test pattern (source line 723).
  return {
    sourceRoot: path.join(tempRoot, 'fake-codex', 'sessions'),
    outputBase: path.join(tempRoot, 'agent-sessions', 'codex'),
  };
}

module.exports = {
  FIXED_NOW,
  FIXED_MTIME,
  VALID_UUID,
  ROLLOUT_TIMESTAMP,
  ROLLOUT_BASE,
  ROLLOUT_FILE,
  ROLLOUT_OUT_FILE,
  YEAR,
  MONTH,
  DAY,
  MAX_BYTES,
  makeTempdir,
  rmrf,
  writeFixtureSession,
  buildBaseDirs,
};
