const fs = require('fs');
const path = require('path');
const { listMarkdownFiles, toPosix } = require('./vault-fs');
const { parseFrontmatter } = require('./frontmatter');
const { ToolError } = require('./tool-error');

const KIND_SCORE = { title: 3, tag: 2, source: 2, body: 1 };
const SNIPPET_MAX = 200;
const LIMIT_MAX = 200;
const LIMIT_DEFAULT = 50;

function snippetFrom(text, idxInLower) {
  const lineStart = text.lastIndexOf('\n', idxInLower - 1) + 1;
  const lineEnd = text.indexOf('\n', idxInLower);
  const endIdx = lineEnd === -1 ? text.length : lineEnd;
  const line = text.slice(lineStart, endIdx).replace(/[\r\n]+/g, ' ').trim();
  if (line.length <= SNIPPET_MAX) return line;
  return line.slice(0, SNIPPET_MAX);
}

function matchInString(haystack, needleLower) {
  if (typeof haystack !== 'string') return -1;
  return haystack.toLowerCase().indexOf(needleLower);
}

function search(realVaultRoot, query, opts = {}) {
  if (typeof query !== 'string' || query.trim() === '') {
    throw new ToolError('INVALID_ARGS', 'query is required');
  }
  const requested = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : LIMIT_DEFAULT;
  const limit = Math.min(requested, LIMIT_MAX);
  const q = query.toLowerCase();

  const files = listMarkdownFiles(realVaultRoot);
  const hits = [];
  for (const file of files) {
    const absPath = path.join(realVaultRoot, ...file.relative_path.split('/'));
    let raw;
    try {
      raw = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(raw);

    // Title match (highest precedence)
    let titleMatch = matchInString(file.title || '', q);
    if (titleMatch >= 0) {
      hits.push({
        relative_path: file.relative_path,
        title: file.title,
        score: KIND_SCORE.title,
        match_kind: 'title',
        snippet: file.title.length > SNIPPET_MAX ? file.title.slice(0, SNIPPET_MAX) : file.title,
        mtime: file.mtime
      });
      continue;
    }

    // Tags match
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    const tagHit = tags.find((t) => matchInString(String(t), q) >= 0);
    if (tagHit !== undefined) {
      hits.push({
        relative_path: file.relative_path,
        title: file.title,
        score: KIND_SCORE.tag,
        match_kind: 'tag',
        snippet: String(tagHit).slice(0, SNIPPET_MAX),
        mtime: file.mtime
      });
      continue;
    }

    // Source match
    if (matchInString(frontmatter.source || '', q) >= 0) {
      hits.push({
        relative_path: file.relative_path,
        title: file.title,
        score: KIND_SCORE.source,
        match_kind: 'source',
        snippet: String(frontmatter.source).slice(0, SNIPPET_MAX),
        mtime: file.mtime
      });
      continue;
    }

    // Body match (lowest precedence) — body only, not raw file
    const bodyIdx = matchInString(body, q);
    if (bodyIdx >= 0) {
      hits.push({
        relative_path: file.relative_path,
        title: file.title,
        score: KIND_SCORE.body,
        match_kind: 'body',
        snippet: snippetFrom(body, bodyIdx),
        mtime: file.mtime
      });
    }
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0;
  });
  const limited = hits.slice(0, limit);
  return { hits: limited, meta: { limit_applied: limit } };
}

module.exports = { search, KIND_SCORE };
