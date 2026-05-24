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
import { CODEX_SCENARIOS } from './scenarios.mjs';
import { runCodexImport } from '../../tools/session-import/import-codex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const DAY_PATH = '2026/01/01';

function countLF(b) {
  let n = 0;
  for (let i = 0; i < b.length; i++) if (b[i] === 0x0a) n += 1;
  return n;
}

function rolloutBase(uuid) {
  return `rollout-2026-01-01T00-00-00-${uuid}`;
}

for (const scen of CODEX_SCENARIOS) {
  test(`codex: ${scen.name} bytes equal expectedFromBaseline(codex)`, async (t) => {
    const tmpRaw = mkTempVault();
    const tmp = fs.realpathSync(tmpRaw);
    t.after(() => cleanupTempVault(tmpRaw));

    const srcRoot = path.join(tmp, 'fake-codex/sessions');
    const outBase = path.join(tmp, 'output');
    const base = rolloutBase(scen.uuid);
    const fixtureSrc = path.join(
      FIXTURES,
      'codex',
      scen.name,
      DAY_PATH,
      base + '.jsonl',
    );
    const fixtureDest = path.join(srcRoot, DAY_PATH, base + '.jsonl');
    copyFixtureWithPinnedMtime(fixtureSrc, fixtureDest);

    const result = await runCodexImport({
      sourceRoot: srcRoot,
      outputBase: outBase,
      maxBytes: 52428800,
      now: FIXED_NOW,
    });
    assert.equal(result.imported, 1, `${scen.name}: one file imported`);
    assert.equal(result.skipped, 0);
    assert.equal(result.errors, 0);

    const outPath = path.join(outBase, DAY_PATH, base + '.md');
    const actual = fs.readFileSync(outPath);
    const baseline = fs.readFileSync(
      path.join(FIXTURES, 'upstream-baseline', `codex-${scen.name}.md`),
    );
    const expected = expectedFromBaseline(baseline, 'codex');
    assert.equal(
      Buffer.compare(actual, expected),
      0,
      `${scen.name}: bytes must equal baseline + inserted 'source: codex' line`,
    );
    assert.equal(
      countLF(actual),
      countLF(baseline) + 1,
      `${scen.name}: exactly one extra LF`,
    );
  });
}
