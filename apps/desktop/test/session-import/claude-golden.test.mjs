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
  expectedFromBaseline,
} from './helpers.mjs';
import { runClaudeImport } from '../../tools/session-import/import-claude.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const CLAUDE_FIXTURE_REL = 'claude/basic/test-project/00000000-0000-4000-8000-000000000001.jsonl';
const CLAUDE_BASELINE = path.join(FIXTURES, 'upstream-baseline/claude-basic.md');
const CLAUDE_UUID = '00000000-0000-4000-8000-000000000001';
const CLAUDE_PROJECT = 'test-project';

test('claude: basic scenario byte-equals expectedFromBaseline under fixed now', async (t) => {
  const tmpRaw = mkTempVault();
  const tmp = fs.realpathSync(tmpRaw);
  t.after(() => cleanupTempVault(tmpRaw));

  const srcRoot = path.join(tmp, 'source');
  const outBase = path.join(tmp, 'output');
  const fixtureSrc = path.join(FIXTURES, CLAUDE_FIXTURE_REL);
  const fixtureDest = path.join(srcRoot, CLAUDE_PROJECT, CLAUDE_UUID + '.jsonl');
  copyFixtureWithPinnedMtime(fixtureSrc, fixtureDest);

  const result = await runClaudeImport({
    sourceRoot: srcRoot,
    outputBase: outBase,
    maxBytes: 52428800,
    now: FIXED_NOW,
  });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);

  const outPath = path.join(outBase, CLAUDE_PROJECT, CLAUDE_UUID + '.md');
  const actual = fs.readFileSync(outPath);
  const baseline = fs.readFileSync(CLAUDE_BASELINE);
  const expected = expectedFromBaseline(baseline, 'claude');
  assert.equal(
    Buffer.compare(actual, expected),
    0,
    'output bytes must equal baseline + inserted `source: claude` line',
  );

  const countLF = (b) => {
    let n = 0;
    for (let i = 0; i < b.length; i++) if (b[i] === 0x0a) n += 1;
    return n;
  };
  assert.equal(
    countLF(actual),
    countLF(baseline) + 1,
    'exactly one extra LF (the inserted `source:` line)',
  );
});

test('claude: basic scenario is idempotent under repeated runs', async (t) => {
  const tmpRaw = mkTempVault();
  const tmp = fs.realpathSync(tmpRaw);
  t.after(() => cleanupTempVault(tmpRaw));

  const srcRoot = path.join(tmp, 'source');
  const outBase = path.join(tmp, 'output');
  const fixtureSrc = path.join(FIXTURES, CLAUDE_FIXTURE_REL);
  const fixtureDest = path.join(srcRoot, CLAUDE_PROJECT, CLAUDE_UUID + '.jsonl');
  copyFixtureWithPinnedMtime(fixtureSrc, fixtureDest);

  const args = {
    sourceRoot: srcRoot,
    outputBase: outBase,
    maxBytes: 52428800,
    now: FIXED_NOW,
  };
  await runClaudeImport(args);
  const outPath = path.join(outBase, CLAUDE_PROJECT, CLAUDE_UUID + '.md');
  const first = fs.readFileSync(outPath);
  await runClaudeImport(args);
  const second = fs.readFileSync(outPath);
  assert.equal(Buffer.compare(first, second), 0, 'idempotent byte-equal');
});
