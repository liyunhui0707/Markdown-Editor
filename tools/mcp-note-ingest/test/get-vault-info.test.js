const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const getVaultInfo = require('../lib/handlers/get-vault-info').handler;

function mkVault() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vault-info-')));
}

test('get_vault_info counts notes, sums bytes, finds last mtime', () => {
  const vault = mkVault();
  const files = [
    ['a.md', 'a', new Date(2024, 0, 1).getTime()],
    ['b.md', 'bb', new Date(2024, 0, 2).getTime()],
    ['sub/c.md', 'ccc', new Date(2024, 0, 3).getTime()],
    ['sub/d.md', 'dddd', new Date(2024, 0, 4).getTime()],
    ['sub/e.md', 'eeeee', new Date(2024, 0, 5).getTime()]
  ];
  fs.mkdirSync(path.join(vault, 'sub'));
  for (const [rel, content, t] of files) {
    const p = path.join(vault, rel);
    fs.writeFileSync(p, content);
    fs.utimesSync(p, t / 1000, t / 1000);
  }
  const expectedLatest = Math.max(...files.map((f) => f[2]));

  const res = getVaultInfo({ vault_path: vault });
  assert.equal(res.structuredContent.note_count, 5);
  assert.equal(res.structuredContent.total_bytes, 1 + 2 + 3 + 4 + 5);
  assert.equal(res.structuredContent.last_modified, expectedLatest);
  assert.equal(res.structuredContent.vault_path, vault);
});

test('get_vault_info on empty vault', () => {
  const vault = mkVault();
  const res = getVaultInfo({ vault_path: vault });
  assert.equal(res.structuredContent.note_count, 0);
  assert.equal(res.structuredContent.total_bytes, 0);
  assert.equal(res.structuredContent.last_modified, null);
});

test('get_vault_info excludes hidden folders', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'a.md'), 'a');
  fs.mkdirSync(path.join(vault, '.obsidian'));
  fs.writeFileSync(path.join(vault, '.obsidian', 'x.md'), 'xxxx');
  const res = getVaultInfo({ vault_path: vault });
  assert.equal(res.structuredContent.note_count, 1);
  assert.equal(res.structuredContent.total_bytes, 1);
});
