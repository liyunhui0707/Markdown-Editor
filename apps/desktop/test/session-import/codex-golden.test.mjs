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
import { runCodexImport } from '../../tools/session-import/import-codex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const CODEX_FIXTURE_REL =
  'codex/basic/2026/01/01/rollout-2026-01-01T00-00-00-019c5f21-83e1-72c2-a129-83fa090f4c41.jsonl';
const CODEX_BASELINE = path.join(FIXTURES, 'upstream-baseline/codex-basic.md');
const CODEX_BASENAME = 'rollout-2026-01-01T00-00-00-019c5f21-83e1-72c2-a129-83fa090f4c41';

test('codex: basic scenario byte-equals expectedFromBaseline under fixed now', async (t) => {
  const tmpRaw = mkTempVault();
  const tmp = fs.realpathSync(tmpRaw);
  t.after(() => cleanupTempVault(tmpRaw));

  const srcRoot = path.join(tmp, 'fake-codex/sessions');
  const outBase = path.join(tmp, 'output');
  const fixtureSrc = path.join(FIXTURES, CODEX_FIXTURE_REL);
  const fixtureDest = path.join(srcRoot, '2026/01/01', CODEX_BASENAME + '.jsonl');
  copyFixtureWithPinnedMtime(fixtureSrc, fixtureDest);

  const result = await runCodexImport({
    sourceRoot: srcRoot,
    outputBase: outBase,
    maxBytes: 52428800,
    now: FIXED_NOW,
  });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);

  const outPath = path.join(outBase, '2026/01/01', CODEX_BASENAME + '.md');
  const actual = fs.readFileSync(outPath);
  const baseline = fs.readFileSync(CODEX_BASELINE);
  const expected = expectedFromBaseline(baseline, 'codex');
  assert.equal(
    Buffer.compare(actual, expected),
    0,
    'output bytes must equal baseline + inserted `source: codex` line',
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
