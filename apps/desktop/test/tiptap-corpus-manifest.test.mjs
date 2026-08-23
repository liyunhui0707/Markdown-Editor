import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateManifest } from './helpers/tiptap-corpus-manifest.mjs';

const fixtureRoot = path.resolve('/virtual/tiptap-roundtrip');
const files = new Map([
  [path.join(fixtureRoot, 'safe.input.md'), '# Input\n'],
  [path.join(fixtureRoot, 'safe.expected.md'), '# Input\n'],
  [path.join(fixtureRoot, 'loss.input.md'), '| A |\n| :- |\n'],
  [path.join(fixtureRoot, 'loss.current.md'), '| A |\n| - |\n'],
  [path.join(fixtureRoot, 'loss.desired.md'), '| A |\n| :- |\n'],
]);

const io = {
  fileExists: (filePath) => files.has(filePath),
  isRegularFile: (filePath) => files.has(filePath),
  readFile: (filePath) => files.get(filePath),
};

const normalized = (overrides = {}) => ({
  id: 'safe',
  category: 'basic',
  contract: 'normalized',
  inputPath: 'safe.input.md',
  expectedPath: 'safe.expected.md',
  ...overrides,
});

const verbatim = (overrides = {}) => ({
  ...normalized(),
  id: 'verbatim',
  contract: 'verbatim',
  requiredFragments: ['# Input'],
  ...overrides,
});

const blocker = (overrides = {}) => ({
  id: 'table-align',
  category: 'table',
  contract: 'blocker',
  inputPath: 'loss.input.md',
  currentLossyPath: 'loss.current.md',
  desiredPath: 'loss.desired.md',
  reason: 'Column alignment is discarded.',
  requiredFragments: ['A'],
  ...overrides,
});

const rejects = (entries, pattern, ioOverrides = io) => {
  assert.throws(() => validateManifest(entries, fixtureRoot, ioOverrides), pattern);
};

test('manifest accepts the exact normalized, verbatim, and blocker contracts', () => {
  const result = validateManifest([normalized(), verbatim(), blocker()], fixtureRoot, io);
  assert.equal(result.length, 3);
  assert.ok(Object.isFrozen(result));
  assert.ok(result.every(Object.isFrozen));
  assert.ok(result.every((entry) => Object.isFrozen(entry.resolvedPaths)));
});

test('manifest must be a non-empty array of plain objects', () => {
  rejects(null, /non-empty array/i);
  rejects([], /non-empty array/i);
  rejects([null], /plain object/i);
  rejects([[]], /plain object/i);
});

test('manifest requires non-empty common string fields and unique ids', () => {
  for (const field of ['id', 'category', 'inputPath']) {
    rejects([normalized({ [field]: '' })], new RegExp(field, 'i'));
    rejects([normalized({ [field]: '   ' })], new RegExp(field, 'i'));
    rejects([normalized({ [field]: 7 })], new RegExp(field, 'i'));
  }
  rejects([normalized(), normalized()], /duplicate.*safe/i);
  rejects([normalized({ contract: 'unknown' })], /contract/i);
});

test('manifest accepts only declared transforms', () => {
  assert.doesNotThrow(() => validateManifest([normalized({ transform: 'crlf' })], fixtureRoot, io));
  assert.doesNotThrow(() => validateManifest([normalized({ transform: 'strip-final-newline' })], fixtureRoot, io));
  rejects([normalized({ transform: '' })], /transform/i);
  rejects([normalized({ transform: 'lf' })], /transform/i);
});

test('manifest enforces exact per-contract field allowlists', () => {
  rejects([normalized({ reason: 'nope' })], /unexpected.*reason/i);
  rejects([normalized({ expectedPath: undefined })], /expectedPath/i);
  rejects([verbatim({ requiredFragments: undefined })], /requiredFragments/i);
  rejects([verbatim({ desiredPath: 'loss.desired.md' })], /unexpected.*desiredPath/i);
  rejects([blocker({ expectedPath: 'safe.expected.md' })], /unexpected.*expectedPath/i);
  for (const field of ['currentLossyPath', 'desiredPath', 'reason', 'requiredFragments']) {
    rejects([blocker({ [field]: undefined })], new RegExp(field, 'i'));
  }
});

test('manifest validates fragment arrays for every contract', () => {
  for (const value of [[], [''], ['   '], ['ok', 1], ['same', 'same']]) {
    rejects([verbatim({ requiredFragments: value })], /requiredFragments/i);
    rejects([blocker({ requiredFragments: value })], /requiredFragments/i);
  }
  rejects([normalized({ requiredFragments: [''] })], /requiredFragments/i);
  assert.doesNotThrow(() => validateManifest([normalized({ requiredFragments: ['# Input'] })], fixtureRoot, io));
});

test('manifest rejects unsafe, missing, and non-file paths', () => {
  rejects([normalized({ inputPath: '/tmp/outside.md' })], /inputPath/i);
  rejects([normalized({ inputPath: '../outside.md' })], /inputPath/i);
  rejects([normalized({ inputPath: 'missing.md' })], /missing.*inputPath/i);
  rejects([normalized({ expectedPath: 'missing.md' })], /missing.*expectedPath/i);
  rejects([normalized()], /regular file/i, {
    ...io,
    isRegularFile: () => false,
  });
});

test('manifest rejects fixture symlinks that target files outside the fixture root', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tiptap-corpus-manifest-'));
  const realFixtureRoot = path.join(temporaryRoot, 'fixtures');
  const outsideInput = path.join(temporaryRoot, 'outside.md');
  fs.mkdirSync(realFixtureRoot);
  fs.writeFileSync(outsideInput, '# Outside\n');
  fs.writeFileSync(path.join(realFixtureRoot, 'safe.expected.md'), '# Outside\n');
  fs.symlinkSync(outsideInput, path.join(realFixtureRoot, 'escaped.input.md'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  assert.throws(
    () => validateManifest([
      normalized({ inputPath: 'escaped.input.md' }),
    ], realFixtureRoot),
    /symbolic link/i,
  );
});

test('blocker paths and reviewed contents must be distinct', () => {
  rejects([blocker({ desiredPath: 'loss.current.md' })], /distinct/i);
  const sameContents = new Map(files);
  sameContents.set(path.join(fixtureRoot, 'loss.desired.md'), sameContents.get(path.join(fixtureRoot, 'loss.current.md')));
  rejects([blocker()], /contents.*distinct/i, {
    ...io,
    readFile: (filePath) => sameContents.get(filePath),
  });
});

test('validated entries are detached from mutable input', () => {
  const source = normalized();
  const [validated] = validateManifest([source], fixtureRoot, io);
  source.id = 'mutated';
  assert.equal(validated.id, 'safe');
});
