import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXED_NOW,
  mkTempVault,
  cleanupTempVault,
  copyFixtureWithPinnedMtime,
} from './helpers.mjs';
import { runClaudeImport } from '../../tools/session-import/import-claude.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const CLAUDE_FIXTURE = path.join(
  FIXTURES,
  'claude/basic/test-project/00000000-0000-4000-8000-000000000001.jsonl',
);

function setupValidSource(tmp) {
  const srcRoot = path.join(tmp, 'source');
  const dest = path.join(
    srcRoot,
    'test-project',
    '00000000-0000-4000-8000-000000000001.jsonl',
  );
  copyFixtureWithPinnedMtime(CLAUDE_FIXTURE, dest);
  return srcRoot;
}

test('output-root: refuses outputBase = /', async () => {
  await assert.rejects(
    runClaudeImport({
      sourceRoot: '/tmp',
      outputBase: '/',
      maxBytes: 1024,
      now: FIXED_NOW,
    }),
    /outputBase must not be/,
  );
});

test('output-root: refuses outputBase = $HOME', async () => {
  await assert.rejects(
    runClaudeImport({
      sourceRoot: '/tmp',
      outputBase: process.env.HOME,
      maxBytes: 1024,
      now: FIXED_NOW,
    }),
    /outputBase must not be/,
  );
});

test('output-root: refuses outputBase that is itself a symlink', async (t) => {
  const tmpRaw = mkTempVault();
  const tmp = fs.realpathSync(tmpRaw);
  t.after(() => cleanupTempVault(tmpRaw));
  const srcRoot = setupValidSource(tmp);
  const real = path.join(tmp, 'real-output');
  fs.mkdirSync(real);
  const link = path.join(tmp, 'link-output');
  fs.symlinkSync(real, link);
  await assert.rejects(
    runClaudeImport({
      sourceRoot: srcRoot,
      outputBase: link,
      maxBytes: 52428800,
      now: FIXED_NOW,
    }),
    /outputBase exists as a symlink|output ancestor is a symlink/,
  );
});

test('output-root: refuses outputBase with intermediate-component symlink', async (t) => {
  const tmpRaw = mkTempVault();
  const tmp = fs.realpathSync(tmpRaw);
  t.after(() => cleanupTempVault(tmpRaw));
  const srcRoot = setupValidSource(tmp);
  const realIntermediate = path.join(tmp, 'real-int');
  fs.mkdirSync(realIntermediate);
  const linkIntermediate = path.join(tmp, 'link-int');
  fs.symlinkSync(realIntermediate, linkIntermediate);
  const outBase = path.join(linkIntermediate, 'output');
  await assert.rejects(
    runClaudeImport({
      sourceRoot: srcRoot,
      outputBase: outBase,
      maxBytes: 52428800,
      now: FIXED_NOW,
    }),
    /output ancestor is a symlink/,
  );
});

test('output-root: refuses outputBase that is a regular file', async (t) => {
  const tmpRaw = mkTempVault();
  const tmp = fs.realpathSync(tmpRaw);
  t.after(() => cleanupTempVault(tmpRaw));
  const srcRoot = setupValidSource(tmp);
  const outFile = path.join(tmp, 'regular-file');
  fs.writeFileSync(outFile, 'not a dir');
  await assert.rejects(
    runClaudeImport({
      sourceRoot: srcRoot,
      outputBase: outFile,
      maxBytes: 52428800,
      now: FIXED_NOW,
    }),
    /outputBase exists but is not a directory/,
  );
});
