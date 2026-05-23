const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const listNotesModule = require('../lib/handlers/list-notes');
const { ToolError } = require('../lib/tool-error');
const { listTools, handlers } = require('../lib/handler-registry');

function mkVault() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'list-notes-')));
}

test('list_notes returns notes for the vault', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'a.md'), '# A\nbody');
  fs.mkdirSync(path.join(vault, 'nested'));
  fs.writeFileSync(path.join(vault, 'nested', 'b.md'), '# B');
  fs.writeFileSync(path.join(vault, 'nested', 'c.md'), 'no heading');

  const res = listNotesModule.handler({ vault_path: vault });
  const rels = res.structuredContent.notes.map((n) => n.relative_path).sort();
  assert.deepEqual(rels, ['a.md', 'nested/b.md', 'nested/c.md']);
  assert.equal(res.content[0].text, '3 notes');
});

test('list_notes excludes hidden entries (folders and files)', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'a.md'), '# A');
  fs.writeFileSync(path.join(vault, '.hidden.md'), '# h');
  fs.mkdirSync(path.join(vault, '.obsidian'));
  fs.writeFileSync(path.join(vault, '.obsidian', 'x.md'), '# x');
  fs.writeFileSync(path.join(vault, 'image.png'), 'png');

  const notes = listNotesModule.handler({ vault_path: vault }).structuredContent.notes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].relative_path, 'a.md');
});

test('list_notes returns empty array for an empty vault', () => {
  const vault = mkVault();
  const notes = listNotesModule.handler({ vault_path: vault }).structuredContent.notes;
  assert.deepEqual(notes, []);
});

test('list_notes throws INVALID_PATH for missing / non-absolute vault_path', () => {
  try { listNotesModule.handler({ vault_path: '' }); assert.fail('expected throw'); }
  catch (err) { assert.equal(err.code, 'INVALID_PATH'); }
  try { listNotesModule.handler({ vault_path: 'relative' }); assert.fail('expected throw'); }
  catch (err) { assert.equal(err.code, 'INVALID_PATH'); }
});

test('list_notes throws NOT_FOUND for non-existent vault and does not create it', () => {
  const parent = mkVault();
  const missing = path.join(parent, 'does-not-exist');
  try { listNotesModule.handler({ vault_path: missing }); assert.fail('expected throw'); }
  catch (err) { assert.equal(err.code, 'NOT_FOUND'); }
  assert.equal(fs.existsSync(missing), false);
});

test('list_notes throws INVALID_PATH when vault_path is a file', () => {
  const parent = mkVault();
  const file = path.join(parent, 'file.txt');
  fs.writeFileSync(file, 'x');
  try { listNotesModule.handler({ vault_path: file }); assert.fail('expected throw'); }
  catch (err) { assert.equal(err.code, 'INVALID_PATH'); }
});

test('list_notes honors subdir / limit / since', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'top.md'), '# top');
  fs.mkdirSync(path.join(vault, 'inner'));
  fs.writeFileSync(path.join(vault, 'inner', 'x.md'), '# x');
  fs.writeFileSync(path.join(vault, 'inner', 'y.md'), '# y');

  const inner = listNotesModule.handler({ vault_path: vault, subdir: 'inner' }).structuredContent.notes;
  assert.deepEqual(inner.map((n) => n.relative_path).sort(), ['inner/x.md', 'inner/y.md']);

  const limited = listNotesModule.handler({ vault_path: vault, limit: 1 }).structuredContent.notes;
  assert.equal(limited.length, 1);

  const a = path.join(vault, 'top.md');
  fs.utimesSync(a, new Date(2025, 0, 1) / 1000, new Date(2025, 0, 1) / 1000);
  const inner1 = path.join(vault, 'inner', 'x.md');
  fs.utimesSync(inner1, new Date(2026, 0, 1) / 1000, new Date(2026, 0, 1) / 1000);
  const inner2 = path.join(vault, 'inner', 'y.md');
  fs.utimesSync(inner2, new Date(2025, 0, 1) / 1000, new Date(2025, 0, 1) / 1000);

  const sinceMid = new Date(2025, 6, 1).getTime();
  const recent = listNotesModule.handler({ vault_path: vault, since: sinceMid }).structuredContent.notes;
  assert.deepEqual(recent.map((n) => n.relative_path), ['inner/x.md']);
});

test('list_notes subdir escape is rejected', () => {
  const vault = mkVault();
  try { listNotesModule.handler({ vault_path: vault, subdir: '../outside' }); assert.fail('expected throw'); }
  catch (err) { assert.equal(err.code, 'INVALID_PATH'); }
});

test('registry advertises list_notes with vault_path required', () => {
  const tools = listTools();
  const tool = tools.find((t) => t.name === 'list_notes');
  assert.ok(tool, 'list_notes must be in tools/list');
  assert.deepEqual(tool.inputSchema.required, ['vault_path']);
  assert.equal(tool.inputSchema.properties.subdir.type, 'string');
  assert.equal(typeof handlers.list_notes, 'function');
});
