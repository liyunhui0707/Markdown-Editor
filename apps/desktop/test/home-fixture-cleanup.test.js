'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHomeFixture } = require('./helpers/home-fixture.cjs');
const finished = { passed: true, quiescent: true };
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-cleanup-unit-'));
  const parent = path.join(root, 'home'); fs.mkdirSync(parent, { mode: 0o700 });
  const f = createHomeFixture('Writing-synthetic-', { parent, cleanupParent: root });
  return { root, parent, f, file: path.join(f.dir, 'copy.md') };
}
function write(s, text = 'Synthetic 中文😀\r\n\r\nsecond') {
  const bytes = Buffer.from(text); fs.writeFileSync(s.file, bytes, { flag: 'wx', mode: 0o600 });
  s.f.recordFile('copy.md', bytes); return bytes;
}
test('success removes only its recorded files and directory after quiescence', () => {
  const s = setup(); write(s);
  fs.mkdirSync(path.join(s.parent, 'unrelated'));
  const r = s.f.cleanup(finished);
  assert.equal(r.state, 'removed', JSON.stringify(r)); assert.equal(fs.existsSync(s.f.dir), false);
  assert.deepEqual(fs.readdirSync(s.parent), ['unrelated']); assert.deepEqual(fs.readdirSync(s.root), ['home']);
  assert.equal(s.f.cleanup(finished).state, 'removed');
});
test('confirmed empty fixture is reclaimable without recursive deletion', () => {
  const s = setup(); assert.equal(s.f.cleanup(finished).state, 'removed');
  assert.deepEqual(fs.readdirSync(s.parent), []);
});
for (const [name, proof] of [['failed', { passed: false, quiescent: true }], ['active', { passed: true, quiescent: false }], ['unknown', {}]]) {
  test(name + ' test or process outcome retains exact bytes', () => {
    const s = setup(), bytes = write(s); const r = s.f.cleanup(proof);
    assert.equal(r.state, 'retained'); assert.deepEqual(fs.readFileSync(s.file), bytes);
  });
}
for (const reason of ['created-partial', 'create-outcome-unknown', 'durability-uncertain', 'race-evidence']) {
  test(reason + ' fixture stays retained even when the negative test passes', () => {
    const s = setup(), bytes = write(s); s.f.keep(reason);
    assert.equal(s.f.cleanup(finished).state, 'retained'); assert.deepEqual(fs.readFileSync(s.file), bytes);
  });
}
test('changed content is retained and cannot be re-certified', () => {
  const s = setup(); write(s); fs.writeFileSync(s.file, 'CHANGED');
  assert.throws(() => s.f.recordFile('copy.md', Buffer.from('CHANGED')));
  assert.equal(s.f.cleanup(finished).state, 'retained'); assert.equal(fs.readFileSync(s.file, 'utf8'), 'CHANGED');
});
test('same bytes at a different inode are retained', () => {
  const s = setup(), bytes = write(s); fs.renameSync(s.file, path.join(s.root, 'original.md'));
  fs.writeFileSync(s.file, bytes, { flag: 'wx', mode: 0o600 });
  assert.equal(s.f.cleanup(finished).state, 'retained'); assert.deepEqual(fs.readFileSync(s.file), bytes);
});
test('directory replacement preserves both race objects', () => {
  const s = setup(); write(s); const moved = s.f.dir + '-moved'; fs.renameSync(s.f.dir, moved);
  fs.mkdirSync(s.f.dir, { mode: 0o700 }); fs.writeFileSync(s.file, 'REPLACEMENT');
  assert.equal(s.f.cleanup(finished).state, 'retained');
  assert.equal(fs.readFileSync(s.file, 'utf8'), 'REPLACEMENT'); assert.equal(fs.existsSync(path.join(moved, 'copy.md')), true);
});
for (const kind of ['extra-file', 'symlink', 'hardlink', 'changed-mode']) {
  test(kind + ' is refused before any file deletion', () => {
    const s = setup(), bytes = write(s);
    if (kind === 'extra-file') fs.writeFileSync(path.join(s.f.dir, 'unexpected.md'), 'KEEP');
    if (kind === 'symlink') { fs.renameSync(s.file, path.join(s.root, 'outside.md')); fs.symlinkSync(path.join(s.root, 'outside.md'), s.file); }
    if (kind === 'hardlink') fs.linkSync(s.file, path.join(s.root, 'alias.md'));
    if (kind === 'changed-mode') fs.chmodSync(s.f.dir, 0o500);
    assert.equal(s.f.cleanup(finished).state, 'retained'); assert.deepEqual(fs.readFileSync(s.file), bytes);
  });
}
test('unexpected object arriving during quarantine is retained without deletion', () => {
  const s = setup(); write(s); const rename = fs.renameSync; let quarantine;
  fs.renameSync = (from, to) => { const r = rename(from, to); if (from === s.f.dir) { quarantine = to; fs.writeFileSync(path.join(to, 'arrived.md'), 'KEEP'); } return r; };
  let result; try { result = s.f.cleanup(finished); } finally { fs.renameSync = rename; }
  assert.equal(result.state, 'retained'); assert.equal(result.path, quarantine);
  assert.equal(fs.readFileSync(path.join(quarantine, 'arrived.md'), 'utf8'), 'KEEP');
  assert.equal(fs.existsSync(path.join(quarantine, 'copy.md')), true);
});
test('invalid names and pre-existing directories cannot be adopted for cleanup', () => {
  const s = setup(); write(s);
  assert.throws(() => s.f.recordFile('../outside.md', Buffer.from('NO')));
  assert.equal(s.f.cleanup(finished).state, 'retained');
  assert.throws(() => createHomeFixture('../escape', { parent: s.parent }));
});
