import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadManifest } from './helpers/tiptap-corpus-manifest.mjs';
import {
  assertReopenSafe,
  engineRoundtrip,
  splitFrontmatter,
} from './helpers/tiptap-roundtrip-harness.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(testDir, 'fixtures', 'tiptap-roundtrip', 'manifest.mjs');
const cases = await loadManifest(manifestPath);

const REQUIRED_CATEGORIES = new Set([
  'blocks', 'marks', 'lists', 'quotes', 'code', 'tables', 'frontmatter',
  'math', 'mermaid', 'images', 'raw', 'references', 'unicode', 'line-endings',
  'empty', 'long-document',
]);

const read = (filePath) => fs.readFileSync(filePath, 'utf8');
const applyTransform = (source, transform) => {
  if (transform === 'crlf') return source.replace(/\n/g, '\r\n');
  if (transform === 'strip-final-newline') return source.replace(/\n$/, '');
  return source;
};

test('corpus manifest has representative coverage and stable ids', () => {
  assert.ok(cases.length >= 24, `expected at least 24 fixtures, received ${cases.length}`);
  const categories = new Set(cases.map((entry) => entry.category));
  for (const category of REQUIRED_CATEGORIES) {
    assert.ok(categories.has(category), `missing corpus category: ${category}`);
  }
  assert.ok(cases.some((entry) => entry.contract === 'blocker'), 'readiness must expose at least one known blocker');
});

for (const entry of cases) {
  const prefix = entry.contract === 'blocker' ? 'PROMOTION BLOCKER' : 'round-trip corpus';
  const options = entry.id === 'long-mixed' ? { timeout: 5000 } : {};

  test(`${prefix}: ${entry.id}`, options, () => {
    const input = applyTransform(read(entry.resolvedPaths.inputPath), entry.transform);
    assertReopenSafe(input, `${entry.id} input`);

    let first;
    assert.doesNotThrow(() => { first = engineRoundtrip(input); }, `${entry.id} first round trip`);
    assertReopenSafe(first, `${entry.id} normalized output`);

    const second = engineRoundtrip(first);
    assert.equal(second, first, `${entry.id} must be stable after first normalization`);

    const inputFrontmatter = splitFrontmatter(input).frontmatter;
    assert.equal(splitFrontmatter(first).frontmatter, inputFrontmatter, `${entry.id} first-pass frontmatter`);
    assert.equal(splitFrontmatter(second).frontmatter, inputFrontmatter, `${entry.id} second-pass frontmatter`);

    if (entry.contract === 'blocker') {
      const currentLossy = read(entry.resolvedPaths.currentLossyPath);
      const desired = read(entry.resolvedPaths.desiredPath);
      assert.equal(first, currentLossy, `${entry.id} current loss changed; investigate before updating fixtures`);
      assert.notEqual(first, desired, `${entry.id} is fixed; reclassify it as a safe contract`);
    } else {
      assert.equal(first, read(entry.resolvedPaths.expectedPath), `${entry.id} normalized output`);
    }

    for (const fragment of entry.requiredFragments || []) {
      assert.ok(first.includes(fragment), `${entry.id} first pass lost fragment: ${fragment}`);
      assert.ok(second.includes(fragment), `${entry.id} second pass lost fragment: ${fragment}`);
    }
  });
}
