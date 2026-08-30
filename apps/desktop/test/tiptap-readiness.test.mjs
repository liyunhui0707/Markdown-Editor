import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.dirname(testDir);
const checkerPath = path.join(desktopDir, 'tools', 'check-tiptap-readiness.mjs');
const packageJsonPath = path.join(desktopDir, 'package.json');

const makeTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tiptap-readiness-'));
const cleanups = [];
process.on('exit', () => {
  for (const dir of cleanups) fs.rmSync(dir, { recursive: true, force: true });
});

function writeManifest(entries, files = {}) {
  const dir = makeTemp();
  cleanups.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents, 'utf8');
  }
  const manifestPath = path.join(dir, 'manifest.mjs');
  fs.writeFileSync(manifestPath, `export default ${JSON.stringify(entries, null, 2)};\n`, 'utf8');
  return { dir, manifestPath };
}

function runChecker(manifestPath, extraArgs = []) {
  const args = [checkerPath];
  if (manifestPath) args.push('--manifest', manifestPath);
  args.push(...extraArgs);
  return spawnSync(process.execPath, args, {
    cwd: desktopDir,
    encoding: 'utf8',
  });
}

const safeEntry = {
  id: 'safe', category: 'blocks', contract: 'normalized',
  inputPath: 'safe.input.md', expectedPath: 'safe.expected.md',
};

test('readiness exits 0 when the validated manifest has no blockers', () => {
  const { manifestPath } = writeManifest([safeEntry], {
    'safe.input.md': '# Safe\n',
    'safe.expected.md': '# Safe\n',
  });
  const result = runChecker(manifestPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /READY.*0 blockers/i);
});

test('readiness exits 1 and prints stable blocker ids and reasons', () => {
  const blocker = {
    id: 'table-align', category: 'tables', contract: 'blocker',
    inputPath: 'input.md', currentLossyPath: 'current.md', desiredPath: 'desired.md',
    reason: 'Alignment is lost.', requiredFragments: ['A'],
  };
  const { manifestPath } = writeManifest([blocker], {
    'input.md': '| A |\n| :- |\n',
    'current.md': '| A |\n| - |\n',
    'desired.md': '| A |\n| :- |\n',
  });
  const result = runChecker(manifestPath);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^BLOCKER table-align: Alignment is lost\.$/m);
});

test('committed readiness keeps only the independent math/currency blocker', () => {
  const result = runChecker();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /^BLOCKER math-currency-delimiter:/m);
  assert.doesNotMatch(result.stdout, /^BLOCKER table-column-alignment:/m);
  assert.equal(result.stdout.trim().split('\n').length, 1, 'exactly one promotion blocker remains');
});

test('readiness fails closed for malformed, missing, and escaping fixtures', () => {
  const empty = writeManifest([]);
  const emptyResult = runChecker(empty.manifestPath);
  assert.notEqual(emptyResult.status, 0);
  assert.match(emptyResult.stderr, /non-empty array/i);

  const missing = writeManifest([safeEntry]);
  const missingResult = runChecker(missing.manifestPath);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /missing inputPath/i);

  const escaping = writeManifest([{ ...safeEntry, inputPath: '../outside.md' }], {
    'safe.expected.md': '# Safe\n',
  });
  const escapingResult = runChecker(escaping.manifestPath);
  assert.notEqual(escapingResult.status, 0);
  assert.match(escapingResult.stderr, /escapes the fixture root/i);
});

test('readiness rejects unknown CLI arguments and a missing manifest value', () => {
  const unknown = spawnSync(process.execPath, [checkerPath, '--unknown'], { encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown argument/i);

  const missingValue = spawnSync(process.execPath, [checkerPath, '--manifest'], { encoding: 'utf8' });
  assert.notEqual(missingValue.status, 0);
  assert.match(missingValue.stderr, /requires a path/i);
});

test('package readiness command runs corpus first with short-circuit chaining', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.equal(
    pkg.scripts['check:tiptap-readiness'],
    'npm run test:tiptap-corpus && node tools/check-tiptap-readiness.mjs',
  );
});

test('a failing corpus-side subprocess prevents readiness-side evaluation', () => {
  const dir = makeTemp();
  cleanups.push(dir);
  const failPath = path.join(dir, 'fail.mjs');
  const sentinelPath = path.join(dir, 'readiness-ran');
  const readyPath = path.join(dir, 'ready.mjs');
  fs.writeFileSync(failPath, 'process.exit(7);\n', 'utf8');
  fs.writeFileSync(readyPath, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinelPath)}, 'ran');\n`, 'utf8');

  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const command = `${quote(process.execPath)} ${quote(failPath)} && ${quote(process.execPath)} ${quote(readyPath)}`;
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
  assert.equal(result.status, 7);
  assert.equal(fs.existsSync(sentinelPath), false, 'readiness side must not run after corpus failure');
});
