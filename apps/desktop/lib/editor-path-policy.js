'use strict';

const path = require('node:path');
const fs = require('node:fs');

// These agent directories belong to AI Session Manager. Match directory
// boundaries, not source metadata: MCP notes and legacy AI Imports stay editable.
function isSessionPath(absolutePath) {
  return /(?:^|\/)inbox\/ai chats\/(?:codex|claude-code)(?:\/|$)/i
    .test(path.resolve(absolutePath).split(path.sep).join('/'));
}

// Resolve the nearest existing ancestor too, so new files beneath a symlinked
// directory obey the same policy as existing files. Do not read file contents.
function resolveExistingAncestor(filePath) {
  try { return fs.realpathSync(filePath); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(filePath);
    if (parent === filePath) throw error;
    return path.join(resolveExistingAncestor(parent), path.basename(filePath));
  }
}

function isSessionLocation(filePath) {
  return isSessionPath(filePath) || isSessionPath(resolveExistingAncestor(path.resolve(filePath)));
}

function validateEditorPath(vaultPath, relativePath = '') {
  if (typeof vaultPath !== 'string' || !vaultPath || typeof relativePath !== 'string'
      || relativePath.includes('\\') || path.isAbsolute(relativePath)) {
    return { ok: false, reason: 'invalid-path', error: 'Invalid note path.' };
  }
  const root = path.resolve(vaultPath);
  const target = path.resolve(root, relativePath);
  const within = (base, value) => value === base || value.startsWith(base + path.sep);
  if (!within(root, target)) {
    return { ok: false, reason: 'outside-vault', error: 'Note path is outside the vault.' };
  }
  try {
    if (isSessionLocation(root) || isSessionLocation(target)) {
      return { ok: false, reason: 'session-library', error: 'Session libraries are managed by AI Session Manager.' };
    }
    if (!within(resolveExistingAncestor(root), resolveExistingAncestor(target))) {
      return { ok: false, reason: 'outside-vault', error: 'Note path is outside the vault.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'invalid-path', error: 'Unable to validate note path.' };
  }
}

module.exports = { isSessionLocation, validateEditorPath };
