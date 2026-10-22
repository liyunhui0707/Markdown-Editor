const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { mergeAttributes, createAtomBlockMarkdownSpec, createInlineMarkdownSpec } = require('@tiptap/core');
const { DOMSerializer } = require('@tiptap/pm/model');
// Exercise the URI resolver used by the packaging schema validator.
const fastURI = createRequire(require.resolve('ajv/package.json'))('fast-uri');
const packagingYaml = createRequire(require.resolve('app-builder-lib/package.json'))('js-yaml');

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
  assert.equal(packageJson.overrides.dompurify, '3.4.14');

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
    dompurifyCopies.every((version) => atLeast(version, '3.4.14')),
    `all DOMPurify copies are patched: ${dompurifyCopies.join(', ')}`,
  );
});

test('locked Tiptap and packaging URI dependencies exclude known vulnerable releases', () => {
  for (const [name, minimum] of [['@tiptap/core', '3.30.5'], ['fast-uri', '3.1.6']]) {
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

test('packaging YAML lockfile excludes vulnerable 4.x merge-budget releases', () => {
  const copies = Object.entries(packageLock.packages)
    .filter(([key]) => key.endsWith('node_modules/js-yaml'));
  assert.ok(copies.length > 0);
  for (const [key, metadata] of copies) {
    assert.equal(metadata.version.split('.')[0], '4', `${key}: reviewed major`);
    assert.ok(atLeast(metadata.version, '4.3.2'), `${key}: patched merge budget`);
  }
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

test('packaging YAML counts empty mappings against its configured merge budget', () => {
  const text = 'empty: &empty {}\ncombined:\n  <<: [*empty, *empty, *empty]\n';
  assert.throws(() => packagingYaml.load(text, { maxTotalMergeKeys: 2 }), /maxTotalMergeKeys/);
});

test('packaging YAML still loads ordinary config and allowed merges', () => {
  const text = 'base: &base {arch: arm64}\nmac:\n  <<: *base\n  target: dir\n';
  assert.deepEqual(packagingYaml.load(text, { maxTotalMergeKeys: 10 }), {
    base: { arch: 'arm64' }, mac: { arch: 'arm64', target: 'dir' },
  });
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

test('fast-uri canonicalizes scheme-relative Unicode hosts', () => {
  assert.equal(fastURI.resolve('https://base.example/', '//ｅxample.com/a'), 'https://example.com/a');
  assert.equal(fastURI.resolve('https://base.example/a/', '../b'), 'https://base.example/b');
  assert.equal(fastURI.normalize('https://example.com/a'), 'https://example.com/a');
});

test('fast-uri rejects malformed IPv6 instead of converting it to a private address', () => {
  for (const host of ['::not-valid', 'fc00::not-hex', 'fe80::not-hex']) {
    assert.ok(fastURI.parse(`http://[${host}]/private`).error, host);
  }
  assert.equal(fastURI.parse('http://[2001:db8::1]/').error, undefined);
});

test('fast-uri never double-decodes an encoded host into localhost', () => {
  const input = 'http://%256c%256f%2563%2561%256c%2568%256f%2573%2574/';
  let output;
  try { output = fastURI.normalize(input); } catch (error) {
    assert.ok(error instanceof Error); return; // Rejection is safe too.
  }
  assert.notEqual(output, 'http://localhost/');
});

test('fast-uri never turns encoded scheme characters into authority or header syntax', () => {
  for (const input of ['%2f%2fother.example:/pwn', '%u002f%u002fother.example:/pwn', 'http%0d%0a:/path']) {
    let output;
    try { output = fastURI.normalize(input); } catch (error) {
      assert.ok(error instanceof Error); continue;
    }
    assert.equal(output.startsWith('//'), false, input);
    assert.doesNotMatch(output, /[\r\n]/);
  }
});
