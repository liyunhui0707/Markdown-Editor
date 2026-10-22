'use strict';

// The legacy main-process parser only retains single-line tags/source. Until
// general YAML preservation exists, fail closed before overwriting anything
// outside this deliberately small subset. This is not a general YAML parser.
function assertSafeFrontmatter(content) {
  if (!/^\uFEFF?---(?:[ \t]*\r?\n|$)/.test(content)) return;
  const block = /^---\n([\s\S]*?)\n---\n/.exec(content);
  const fail = () => { throw new Error(
    'Save blocked: this note has unsupported frontmatter. The original file is unchanged. '
    + 'Keep your edits and use a YAML-capable editor to preserve its metadata.'
  ); };
  if (!block) fail();
  const seen = new Set();
  // Only simple string values that remain strings when emitted unquoted.
  const scalar = value => {
    const text = value.replace(/^(?:"([^"\\]*)"|'([^']*)')$/, (_m, a, b) => a ?? b);
    if (text !== text.trim()) return false; // Serialization would lose quoted boundary whitespace.
    return /^[\p{L}_][\p{L}\p{N}_ ./:@+\-]*$/u.test(text)
      && !/:(?:\s|$)/.test(text) && !/^(?:true|false|null|yes|no|on|off)$/i.test(text);
  };
  for (const line of block[1].split('\n')) {
    if (!line.trim()) continue;
    const match = /^(tags|source):[ \t]*(.*)$/.exec(line);
    if (!match || seen.has(match[1])) fail();
    seen.add(match[1]);
    const value = match[2].trim();
    if (match[1] === 'source') {
      if (!scalar(value)) fail();
    } else {
      if (!/^\[.*\]$/.test(value)) fail();
      const items = value.slice(1, -1).trim();
      if (items && !items.split(',').every(item => scalar(item.trim()))) fail();
    }
  }
}

module.exports = { assertSafeFrontmatter };
