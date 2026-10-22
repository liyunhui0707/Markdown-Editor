'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeFrontmatterScalar } = require('../lib/frontmatter-scalar');

// Retained from session-title.test.js: general frontmatter must not regress
// when the session-specific title resolver is removed.
test('frontmatter decoding preserves JSON-quoted escapes and YAML-sensitive text', () => {
  const value = 'Release: "alpha" #1';
  assert.equal(decodeFrontmatterScalar(JSON.stringify(value)), value);
});

test('frontmatter decoder retains permissive single-quoted and malformed scalar behavior', () => {
  assert.equal(decodeFrontmatterScalar("'codex'"), 'codex');
  assert.equal(decodeFrontmatterScalar('"bad\\q"'), 'bad\\q');
  assert.equal(decodeFrontmatterScalar('claude'), 'claude');
});
