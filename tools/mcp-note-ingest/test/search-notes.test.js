const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const searchNotes = require('../lib/handlers/search-notes').handler;

function mkVault() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'search-')));
}

function setTimes(p, t) {
  fs.utimesSync(p, t / 1000, t / 1000);
}

test('body match: returns hits with score 1 and bounded snippet', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'n1.md'), '# n1\n\nalpha banana\n');
  fs.writeFileSync(path.join(vault, 'n2.md'), '# n2\n\nbeta\n');
  fs.writeFileSync(path.join(vault, 'n3.md'), '# n3\n\n' + 'x'.repeat(300) + 'alpha' + 'y'.repeat(50) + '\n');
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  const rels = res.structuredContent.hits.map((h) => h.relative_path).sort();
  assert.deepEqual(rels, ['n1.md', 'n3.md']);
  for (const h of res.structuredContent.hits) {
    assert.ok(h.snippet.length <= 200, `snippet too long: ${h.snippet.length}`);
    assert.equal(h.score, 1);
    assert.equal(h.match_kind, 'body');
  }
});

test('title match: precedence over body, score 3', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'n.md'), '# Alpha Project\n\nbody without keyword\n');
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits.length, 1);
  assert.equal(res.structuredContent.hits[0].match_kind, 'title');
  assert.equal(res.structuredContent.hits[0].score, 3);
});

test('tag match: score 2', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'n.md'), '---\ntags: [alpha]\n---\n\nbody without keyword\n');
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits.length, 1);
  assert.equal(res.structuredContent.hits[0].match_kind, 'tag');
  assert.equal(res.structuredContent.hits[0].score, 2);
});

test('source match: score 2', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'n.md'), '---\nsource: "alpha-bot"\n---\n\nbody without keyword\n');
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits.length, 1);
  assert.equal(res.structuredContent.hits[0].match_kind, 'source');
  assert.equal(res.structuredContent.hits[0].score, 2);
});

test('non-md files are ignored', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'n.md'), 'no match here\n');
  fs.writeFileSync(path.join(vault, 'leak.txt'), 'alpha and more\n');
  fs.writeFileSync(path.join(vault, 'leak.pdf'), 'alpha\n');
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits.length, 0);
});

test('hidden notes are ignored', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, '.hidden.md'), '# alpha\n');
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits.length, 0);
});

test('empty query throws INVALID_ARGS', () => {
  const vault = mkVault();
  try { searchNotes({ vault_path: vault, query: '' }); assert.fail('expected throw'); }
  catch (err) { assert.equal(err.code, 'INVALID_ARGS'); }
  try { searchNotes({ vault_path: vault, query: '   ' }); assert.fail('expected throw'); }
  catch (err) { assert.equal(err.code, 'INVALID_ARGS'); }
});

test('no matches returns empty hits', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'n.md'), 'beta\n');
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.deepEqual(res.structuredContent.hits, []);
});

test('regex-meta chars treated literally', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'a.md'), 'has a.b literally\n');
  fs.writeFileSync(path.join(vault, 'b.md'), 'has axb but not the literal\n');
  const res = searchNotes({ vault_path: vault, query: 'a.b' });
  const rels = res.structuredContent.hits.map((h) => h.relative_path);
  assert.deepEqual(rels, ['a.md']);
});

test('case-insensitive default: "Alpha" matches "alpha"', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'n.md'), 'alpha lives here\n');
  const res = searchNotes({ vault_path: vault, query: 'Alpha' });
  assert.equal(res.structuredContent.hits.length, 1);
});

test('limit is clamped to 200; meta.limit_applied is exposed', () => {
  const vault = mkVault();
  for (let i = 0; i < 60; i++) {
    fs.writeFileSync(path.join(vault, `n${String(i).padStart(3, '0')}.md`), 'alpha\n');
  }
  const def = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(def.structuredContent.hits.length, 50);
  assert.equal(def.structuredContent.meta.limit_applied, 50);

  const big = searchNotes({ vault_path: vault, query: 'alpha', limit: 200 });
  assert.equal(big.structuredContent.hits.length, 60);
  assert.equal(big.structuredContent.meta.limit_applied, 200);

  const clamped = searchNotes({ vault_path: vault, query: 'alpha', limit: 500 });
  assert.equal(clamped.structuredContent.meta.limit_applied, 200);
});

test('match precedence: title beats body for same note', () => {
  const vault = mkVault();
  fs.writeFileSync(path.join(vault, 'n.md'), '# alpha\n\nalpha too\n');
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits.length, 1);
  assert.equal(res.structuredContent.hits[0].match_kind, 'title');
});

test('score-then-mtime sort: title (3) appears before body (1) when mtimes equal', () => {
  const vault = mkVault();
  const t = new Date(2026, 0, 1).getTime();
  const titleNote = path.join(vault, 'title-hit.md');
  const bodyNote = path.join(vault, 'body-hit.md');
  fs.writeFileSync(titleNote, '# alpha\n\nignore\n');
  fs.writeFileSync(bodyNote, '# unrelated\n\nalpha here\n');
  setTimes(titleNote, t);
  setTimes(bodyNote, t);
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits[0].match_kind, 'title');
  assert.equal(res.structuredContent.hits[1].match_kind, 'body');
});

test('stable sort: two equal-mtime equal-score hits sorted by relative_path ascending', () => {
  const vault = mkVault();
  const t = new Date(2026, 0, 1).getTime();
  const a = path.join(vault, 'a.md');
  const b = path.join(vault, 'b.md');
  fs.writeFileSync(a, 'alpha\n');
  fs.writeFileSync(b, 'alpha\n');
  setTimes(a, t);
  setTimes(b, t);
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits[0].relative_path, 'a.md');
  assert.equal(res.structuredContent.hits[1].relative_path, 'b.md');
});

test('tag search finds block-sequence YAML tags', () => {
  const vault = mkVault();
  fs.writeFileSync(
    path.join(vault, 'n.md'),
    '---\ntags:\n  - alpha\n  - beta\n---\n\nbody without keyword\n'
  );
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits.length, 1);
  assert.equal(res.structuredContent.hits[0].match_kind, 'tag');
});

test('body matching excludes frontmatter keys (created_at, model)', () => {
  const vault = mkVault();
  fs.writeFileSync(
    path.join(vault, 'n.md'),
    '---\ncreated_at: "alpha-2026"\nmodel: "alpha-bot"\n---\n\nplain body without keyword\n'
  );
  const res = searchNotes({ vault_path: vault, query: 'alpha' });
  assert.equal(res.structuredContent.hits.length, 0, 'created_at/model are not part of the search surface');
});
