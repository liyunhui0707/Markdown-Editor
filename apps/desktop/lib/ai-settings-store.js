'use strict';

// Stage C: persistence for the user-editable subset of AI settings, written by
// the in-app settings panel. The IPC layer supplies the file path (Electron
// userData/ai-settings.json). This module is a dumb, defensive JSON store:
// only baseUrl / model / allowRemote are ever read or written, with strict
// types. URL validity is enforced one layer up (ai-settings-ipc, reusing
// normalizeBaseUrl) — here we only guarantee a typed round-trip and never throw
// on a missing or corrupt file.

const fs = require('node:fs');

const STORED_KEYS = ['baseUrl', 'model', 'allowRemote'];

// Keep only valid, whitelisted fields. Strings are trimmed and must be
// non-empty; allowRemote must be a real boolean. Everything else is dropped.
function sanitize(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  if (typeof obj.baseUrl === 'string' && obj.baseUrl.trim() !== '') out.baseUrl = obj.baseUrl.trim();
  if (typeof obj.model === 'string' && obj.model.trim() !== '') out.model = obj.model.trim();
  if (typeof obj.allowRemote === 'boolean') out.allowRemote = obj.allowRemote;
  return out;
}

function readStoredSettings(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return {}; // missing file (or unreadable) — treat as no stored settings
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return {}; // corrupt JSON — never let a hand-edited file break boot
  }
  return sanitize(parsed);
}

function writeStoredSettings(filePath, partial) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('writeStoredSettings: filePath must be a non-empty string');
  }
  const merged = { ...readStoredSettings(filePath), ...sanitize(partial) };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

module.exports = { readStoredSettings, writeStoredSettings, STORED_KEYS };
