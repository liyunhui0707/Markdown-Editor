const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mergeAttributes, createAtomBlockMarkdownSpec, createInlineMarkdownSpec } = require('@tiptap/core');
const { DOMSerializer } = require('@tiptap/pm/model');
const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));

function atLeast(actual, minimum) {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] !== minimumParts[index]) {
      return actualParts[index] > minimumParts[index];
    }
  }
  return true;
}

test('renderer dependency policy keeps Mermaid and DOMPurify on patched releases', () => {
  assert.equal(packageJson.dependencies.mermaid, '^11.17.0');
  assert.equal(packageJson.overrides.dompurify, '3.4.17');

  const rootLock = packageLock.packages[''];
  assert.equal(rootLock.version, packageJson.version, 'lockfile app version follows package.json');
  assert.equal(rootLock.dependencies.mermaid, packageJson.dependencies.mermaid);

  const mermaid = packageLock.packages['node_modules/mermaid'];
  assert.ok(mermaid && atLeast(mermaid.version, '11.17.0'), 'Mermaid is patched');

  const dompurifyCopies = Object.entries(packageLock.packages)
    .filter(([packagePath]) => packagePath.endsWith('node_modules/dompurify'))
    .map(([, metadata]) => metadata.version);
  assert.ok(dompurifyCopies.length > 0, 'DOMPurify is present in the lockfile');
  assert.ok(
    dompurifyCopies.every((version) => atLeast(version, '3.4.17')),
    `all DOMPurify copies are patched: ${dompurifyCopies.join(', ')}`,
  );
});

test('math, Electron and build dependency locks meet the November security floor', () => {
  const floors = { katex: '0.18.2', electron: '43.8.1', undici: '6.29.1' };
  for (const [name, minimum] of Object.entries(floors)) {
    const copies = Object.entries(packageLock.packages)
      .filter(([key]) => key.endsWith(`node_modules/${name}`));
    assert.ok(copies.length > 0, name);
    for (const [key, metadata] of copies) {
      const floor = name === 'undici' && metadata.version.startsWith('7.') ? '7.30.1' : minimum;
      assert.ok(atLeast(metadata.version, floor), `${key}: ${metadata.version} < ${floor}`);
    }
  }
  const braces = Object.entries(packageLock.packages)
    .filter(([key]) => key.endsWith('node_modules/brace-expansion'));
  assert.ok(braces.length > 0);
  for (const [key, metadata] of braces) {
    const floor = { 1: '1.1.21', 2: '2.1.7', 5: '5.0.12' }[metadata.version.split('.')[0]];
    assert.ok(floor && atLeast(metadata.version, floor), `${key}: reviewed patched series`);
  }
});

test('KaTeX ignores inherited trust while preserving ordinary formula rendering', () => {
  const katex = require('katex');
  const options = Object.assign(Object.create({ trust: true }), { strict: 'ignore' });
  const denied = katex.renderToString(String.raw`\href{https://example.invalid/synthetic}{x}`, options);
  assert.doesNotMatch(denied, /href=/, 'inherited trust must not enable links');
  for (const displayMode of [false, true]) {
    const rendered = katex.renderToString(String.raw`\frac{1}{2} + x^2`, { displayMode, trust: false });
    assert.match(rendered, /class="katex/);
    assert.match(rendered, /<mfrac>/);
    assert.match(rendered, /<msup>/);
    assert.doesNotMatch(rendered, /katex-error/);
  }
});

test('locked Tiptap excludes known vulnerable releases', () => {
  for (const [name, minimum] of [['@tiptap/core', '3.30.5']]) {
    const copies = Object.entries(packageLock.packages)
      .filter(([key]) => key.endsWith(`node_modules/${name}`));
    assert.ok(copies.length > 0, name);
    for (const [key, metadata] of copies) {
      // A future major upgrade needs a separate advisory/range review.
      assert.equal(metadata.version.split('.')[0], '3', `${key}: reviewed major`);
      assert.ok(atLeast(metadata.version, minimum), `${key}: ${metadata.version} < ${minimum}`);
    }
  }
});

test('the retired builder chain and its vulnerable parsers are absent from the complete lock',()=>{
 for(const name of ['electron-builder','app-builder-lib','@electron/rebuild','node-gyp','tinyglobby','picomatch','fast-uri','js-yaml'])
  assert(!Object.keys(packageLock.packages).some(p=>p.endsWith('node_modules/'+name)),name);
 assert.equal(packageJson.devDependencies['@electron/packager'],'20.3.0');
 assert.equal(packageJson.devDependencies['@electron/asar'],'4.3.2');
});

// GHSA-j95f-988m-3j2f. Run bounded synthetic adversarial inputs in a child:
// a regression cannot hang the test runner. Three seconds includes startup
// and is a generous ceiling, not a UI-performance target or scaling claim.
for (const kind of ['block', 'inline']) {
  test(`Tiptap ${kind} attribute tokenizer completes adversarial input within a bounded process`, () => {
    const script = `
      const assert = require('node:assert/strict');
      const core = require('@tiptap/core');
      const block = ${JSON.stringify(kind)} === 'block';
      const factory = block ? core.createAtomBlockMarkdownSpec : core.createInlineMarkdownSpec;
      const spec = factory({ nodeName: 'securityProbe', selfClosing: true });
      const attributes = block ? '__QUOTED_0'.repeat(16384) : 'z'.repeat(131072);
      const input = block ? ':::securityProbe {' + attributes + '} :::\\n'
        : '[securityProbe ' + attributes + ']';
      const token = spec.markdownTokenizer.tokenize(input, [], {});
      assert.ok(token);
      assert.equal(token.raw, input);
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: projectRoot, encoding: 'utf8', timeout: 3000, maxBuffer: 65536,
    });
    assert.equal(result.error, undefined, `${kind}: ${result.error?.message}`);
    assert.equal(result.status, 0, result.stderr);
  });
}

test('Tiptap Markdown helper attributes retain ordinary quoted values', () => {
  const block = createAtomBlockMarkdownSpec({ nodeName: 'securityProbe' });
  const inline = createInlineMarkdownSpec({ nodeName: 'securityProbe', selfClosing: true });
  const a = block.markdownTokenizer.tokenize(':::securityProbe {.note #demo label="中文 text"} :::\n', [], {});
  assert.deepEqual(a.attributes, { class: 'note', id: 'demo', label: '中文 text' });
  const b = inline.markdownTokenizer.tokenize('[securityProbe label="中文 text"]', [], {});
  assert.equal(b.attributes.label, '中文 text');
});

test('Tiptap attribute merging cannot inject inherited DOM event attributes', () => {
  // GHSA-cp6q-959q-f8rh: JSON has an OWN __proto__ property (unlike a literal).
  const input = JSON.parse('{"__proto__":{"onerror":"synthetic-canary","src":"invalid:"},"alt":"safe"}');
  const attrs = mergeAttributes(input);
  assert.equal(Object.getPrototypeOf(attrs), Object.prototype);
  assert.equal(attrs.onerror, undefined);
  assert.equal(Object.prototype.onerror, undefined);
  const document = { createElement: () => ({
    nodeType: 1, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
  }) };
  const { dom } = DOMSerializer.renderSpec(document, ['img', attrs]);
  assert.deepEqual(dom.attributes, { alt: 'safe' });
});

test('Tiptap still merges ordinary classes, styles and image attributes', () => {
  const attrs = mergeAttributes({ class: 'a b', style: 'color: red', alt: 'old' },
    { class: 'b c', style: 'color: blue; text-align: center', alt: '中文' });
  assert.equal(attrs.class, 'a b c');
  assert.equal(attrs.alt, '中文');
  assert.match(attrs.style, /color: blue/);
  assert.match(attrs.style, /text-align: center/);
});
