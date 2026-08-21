const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
