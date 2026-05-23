const fs = require('fs');
const path = require('path');
const { ToolError } = require('./tool-error');

function validateReadSideVault(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ToolError('INVALID_PATH', 'vault_path must be a non-empty string');
  }
  const trimmed = input.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new ToolError('INVALID_PATH', 'vault_path must be absolute');
  }
  let stat;
  try {
    stat = fs.statSync(trimmed);
  } catch {
    throw new ToolError('NOT_FOUND', 'vault_path does not exist');
  }
  if (!stat.isDirectory()) {
    throw new ToolError('INVALID_PATH', 'vault_path is not a directory');
  }
  return fs.realpathSync(trimmed);
}

function realPathOfNearestAncestor(absPath) {
  let current = absPath;
  while (true) {
    if (fs.existsSync(current)) {
      return { realAncestor: fs.realpathSync(current), tail: '' };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ToolError('INVALID_PATH', 'no existing ancestor for path');
    }
    const tailSoFar = path.relative(parent, absPath);
    current = parent;
    if (fs.existsSync(current)) {
      return { realAncestor: fs.realpathSync(current), tail: tailSoFar };
    }
  }
}

function resolveRelativePath(realVaultRoot, relPath) {
  if (typeof relPath !== 'string' || relPath === '') {
    throw new ToolError('INVALID_PATH', 'relative_path must be a non-empty string');
  }
  if (path.isAbsolute(relPath)) {
    throw new ToolError('INVALID_PATH', 'relative_path must not be absolute');
  }
  const joined = path.resolve(realVaultRoot, relPath);
  const { realAncestor, tail } = realPathOfNearestAncestor(joined);
  const realTarget = tail === '' ? realAncestor : path.join(realAncestor, tail);
  const rel = path.relative(realVaultRoot, realTarget);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ToolError('INVALID_PATH', 'relative_path escapes vault');
  }
  return realTarget;
}

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function extractTitle(absPath, fallback) {
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.slice(0, bytesRead).toString('utf8');
    const match = head.match(/^# +(.+?)\s*$/m);
    if (match) return match[1];
  } catch {
    // fall through
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
  return fallback;
}

function listMarkdownFiles(realVaultRoot, opts = {}) {
  const { subdir, limit, since } = opts;
  let start = realVaultRoot;
  if (subdir != null && subdir !== '') {
    start = resolveRelativePath(realVaultRoot, subdir);
    let stat;
    try {
      stat = fs.statSync(start);
    } catch {
      throw new ToolError('NOT_FOUND', 'subdir does not exist');
    }
    if (!stat.isDirectory()) {
      throw new ToolError('INVALID_PATH', 'subdir is not a directory');
    }
  }

  const out = [];
  const stack = [start];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absChild = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absChild);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        let stat;
        try {
          stat = fs.statSync(absChild);
        } catch {
          continue;
        }
        const mtime = Math.round(stat.mtimeMs);
        if (typeof since === 'number' && !(mtime > since)) continue;
        const rel = toPosix(path.relative(realVaultRoot, absChild));
        const base = entry.name.slice(0, -3); // strip .md
        const title = extractTitle(absChild, base);
        out.push({
          relative_path: rel,
          title,
          size: stat.size,
          mtime
        });
        if (typeof limit === 'number' && out.length >= limit) {
          return out;
        }
      }
    }
  }
  return out;
}

module.exports = {
  validateReadSideVault,
  resolveRelativePath,
  listMarkdownFiles,
  toPosix
};
