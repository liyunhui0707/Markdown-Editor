'use strict';

/* tiptap-image-nodeview — the security render path, headless via a fake document.

   Proves the rendered DOM never creates an unsafe fetch surface: rejected URLs
   get NO <img>; vault-relative images start with no src, call the IPC, and set
   src ONLY on a strictly-valid file: URL; late async after destroy() is a no-op. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildImageNodeView } = require('../lib/tiptap-image-nodeview.js');

function makeFakeDocument() {
  function createElement(tag) {
    return {
      _tag: tag,
      attributes: {},
      children: [],
      style: {},
      textContent: '',
      parentNode: null,
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
      },
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        child.parentNode = null;
        return child;
      },
    };
  }
  return { createElement };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const node = (src, alt) => ({ type: 'image', attrs: { src, alt: alt || '' } });
const imgs = (dom) => dom.children.filter((c) => c._tag === 'img');
const rejects = (dom) => dom.children.filter((c) => c._tag === 'span' && c.attributes.class === 'tiptap-image-rejected');

function build(src, opts) {
  const o = opts || {};
  const document = makeFakeDocument();
  const nv = buildImageNodeView(node(src, o.alt), {
    getNoteDir: o.getNoteDir,
    resolveImagePath: o.resolveImagePath,
  }, { document });
  return nv;
}

// ── reject: NO <img>, NO src, NO fetch ──────────────────────────────────────
for (const bad of ['javascript:alert(1)', 'http://x/y.png', 'file:///etc/passwd',
                   'blob:https://x/abc', '/etc/passwd', 'foo\x00bar', 'data:text/html,<x>']) {
  test(`reject: ${JSON.stringify(bad)} renders placeholder, no <img>`, () => {
    let called = 0;
    const nv = build(bad, { alt: 'A', getNoteDir: () => '', resolveImagePath: () => { called++; return Promise.resolve({ ok: true, fileUrl: 'file:///x' }); } });
    assert.equal(imgs(nv.dom).length, 0, 'no <img> created for an unsafe URL');
    assert.equal(rejects(nv.dom).length, 1, 'rejected placeholder present');
    assert.equal(nv.dom.children[0].textContent, 'A', 'placeholder shows alt text');
    assert.equal(called, 0, 'resolver not called for a non-vault-relative URL');
  });
}

// ── direct: https/data set src synchronously, no IPC ────────────────────────
for (const good of ['https://example.com/x.png', 'data:image/png;base64,iVB']) {
  test(`direct: ${JSON.stringify(good)} sets <img src> synchronously`, () => {
    let called = 0;
    const nv = build(good, { getNoteDir: () => '', resolveImagePath: () => { called++; return Promise.resolve({ ok: true, fileUrl: 'file:///x' }); } });
    const i = imgs(nv.dom);
    assert.equal(i.length, 1);
    assert.equal(i[0].getAttribute('src'), good);
    assert.equal(i[0].getAttribute('loading'), 'lazy');
    assert.equal(called, 0, 'no IPC for https/data');
  });
}

// ── resolve: vault-relative ─────────────────────────────────────────────────
test('resolve: <img> starts with NO src and calls resolveImagePath(noteDir, src)', () => {
  const args = [];
  const nv = build('./assets/x.png', {
    getNoteDir: () => 'notes',
    resolveImagePath: (dir, rel) => { args.push([dir, rel]); return new Promise(() => {}); },
  });
  const i = imgs(nv.dom);
  assert.equal(i.length, 1);
  assert.equal(i[0].getAttribute('src'), null, 'no src until IPC resolves');
  assert.deepEqual(args, [['notes', './assets/x.png']]);
});

test('resolve: valid {ok,fileUrl:file://} sets src', async () => {
  const nv = build('./a.png', { getNoteDir: () => '', resolveImagePath: () => Promise.resolve({ ok: true, fileUrl: 'file:///v/a.png' }) });
  await flush();
  assert.equal(imgs(nv.dom)[0].getAttribute('src'), 'file:///v/a.png');
  assert.equal(rejects(nv.dom).length, 0);
});

test('resolve: {ok:false} -> placeholder, no src', async () => {
  const nv = build('./a.png', { alt: 'X', getNoteDir: () => '', resolveImagePath: () => Promise.resolve({ ok: false, reason: 'outside-vault' }) });
  await flush();
  assert.equal(imgs(nv.dom).length, 0);
  assert.equal(rejects(nv.dom).length, 1);
});

// strict result gate: even ok:true must be a clean file: URL
for (const badResult of [
  { ok: true, fileUrl: 'javascript:alert(1)' },
  { ok: true, fileUrl: 'file:///v/a\x00.png' },
  { ok: true, fileUrl: 'https://evil/x' },
  { ok: true, fileUrl: 123 },
  { ok: true },
]) {
  test(`resolve: strict gate rejects ${JSON.stringify(badResult)}`, async () => {
    const nv = build('./a.png', { getNoteDir: () => '', resolveImagePath: () => Promise.resolve(badResult) });
    await flush();
    assert.equal(imgs(nv.dom).length, 0, 'must not set src for a non-file:/malformed result');
    assert.equal(rejects(nv.dom).length, 1);
  });
}

test('resolve: rejected promise -> placeholder', async () => {
  const nv = build('./a.png', { getNoteDir: () => '', resolveImagePath: () => Promise.reject(new Error('boom')) });
  await flush();
  assert.equal(imgs(nv.dom).length, 0);
  assert.equal(rejects(nv.dom).length, 1);
});

test('resolve: synchronous throw -> placeholder', () => {
  const nv = build('./a.png', { getNoteDir: () => '', resolveImagePath: () => { throw new Error('sync'); } });
  assert.equal(rejects(nv.dom).length, 1);
});

test('resolve: no resolver provided -> placeholder', () => {
  const nv = build('./a.png', { getNoteDir: () => '' });
  assert.equal(imgs(nv.dom).length, 0);
  assert.equal(rejects(nv.dom).length, 1);
});

test('resolve: late resolution AFTER destroy() is a no-op', async () => {
  let resolveFn;
  const p = new Promise((r) => { resolveFn = r; });
  const nv = build('./a.png', { getNoteDir: () => '', resolveImagePath: () => p });
  nv.destroy();
  resolveFn({ ok: true, fileUrl: 'file:///v/a.png' });
  await flush();
  assert.equal(imgs(nv.dom)[0].getAttribute('src'), null, 'destroyed view must not set src');
  assert.equal(rejects(nv.dom).length, 0, 'destroyed view must not mutate DOM at all');
});

// ── update: rebuild on render-affecting attr change ─────────────────────────
test('update: same src+alt -> true (keep DOM)', () => {
  const nv = build('https://x/y.png', { alt: 'A' });
  assert.equal(nv.update(node('https://x/y.png', 'A')), true);
});

test('update: different alt -> false (force rebuild)', () => {
  const nv = build('https://x/y.png', { alt: 'A' });
  assert.equal(nv.update(node('https://x/y.png', 'B')), false);
});

test('update: different src -> false (force rebuild)', () => {
  const nv = build('https://x/y.png', { alt: 'A' });
  assert.equal(nv.update(node('https://x/z.png', 'A')), false);
});

test('update: different node type -> false', () => {
  const nv = build('https://x/y.png', { alt: 'A' });
  assert.equal(nv.update({ type: 'paragraph', attrs: { src: 'https://x/y.png', alt: 'A' } }), false);
});

test('update: vault-relative, same src+alt but CHANGED note dir -> false (re-resolve for new note)', () => {
  let dir = 'notes/a';
  const document = makeFakeDocument();
  const nv = buildImageNodeView(node('./img.png', 'x'), {
    getNoteDir: () => dir,
    resolveImagePath: () => new Promise(() => {}), // pending; we only test update()
  }, { document });
  assert.equal(nv.update(node('./img.png', 'x')), true, 'same dir -> keep');
  dir = 'notes/b';
  assert.equal(nv.update(node('./img.png', 'x')), false, 'dir changed -> rebuild + fresh IPC resolution');
});

test('update: direct https image is unaffected by note dir changes', () => {
  let dir = 'notes/a';
  const document = makeFakeDocument();
  const nv = buildImageNodeView(node('https://x/y.png', 'x'), {
    getNoteDir: () => dir,
  }, { document });
  dir = 'notes/b';
  assert.equal(nv.update(node('https://x/y.png', 'x')), true, 'https is not vault-relative -> dir irrelevant');
});
