/* Phase A — shared test helpers for the Claude importer tests.
   Not a *.test.js file, so the npm-test glob does not pick it up. */

'use strict';

const fs   = require('node:fs/promises');
const path = require('node:path');
const os   = require('node:os');

const FIXED_NOW   = new Date('2026-05-23T00:00:00.000Z');
const FIXED_MTIME = new Date('2026-05-22T12:00:00.000Z');
const VALID_UUID  = '12345678-1234-1234-1234-123456789012';
const PROJECT     = '-Users-test-myproject';
const MAX_BYTES   = 10485760;

async function makeTempdir() {
  // Realpath the tmpdir: on macOS, os.tmpdir() returns /var/folders/...
  // and /var is a symlink to /private/var. The importer's validateAncestorChain
  // (matching the source) refuses to create output under any symlink ancestor,
  // so tests must use the canonical /private/var path.
  const t = await fs.mkdtemp(path.join(os.tmpdir(), 'phase-a-claude-'));
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
  const projectName = opts.projectName || PROJECT;
  const uuid        = opts.uuid || VALID_UUID;
  const records     = opts.records || [
    { type: 'user', timestamp: '2026-05-22T11:00:00.000Z', message: { content: 'hello' } },
    { type: 'assistant', timestamp: '2026-05-22T11:00:01.000Z', message: { content: [{ type: 'text', text: 'hi back' }] } },
  ];
  const projectDir = path.join(tempRoot, 'projects', projectName);
  await fs.mkdir(projectDir, { recursive: true });
  const filePath = path.join(projectDir, uuid + '.jsonl');
  const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await fs.writeFile(filePath, body, 'utf8');
  await fs.utimes(filePath, FIXED_MTIME, FIXED_MTIME);
  return { projectName, uuid, filePath, projectDir };
}

function buildBaseDirs(tempRoot) {
  return {
    sourceRoot: path.join(tempRoot, 'projects'),
    outputBase: path.join(tempRoot, 'agent-sessions', 'claude-code'),
  };
}

module.exports = {
  FIXED_NOW,
  FIXED_MTIME,
  VALID_UUID,
  PROJECT,
  MAX_BYTES,
  makeTempdir,
  rmrf,
  writeFixtureSession,
  buildBaseDirs,
};
