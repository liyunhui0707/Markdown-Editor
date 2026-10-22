'use strict';

// Preserve permissive scalar decoding used by ordinary notes and AI Imports.
function decodeFrontmatterScalar(value) {
  const raw = String(value);
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try { return JSON.parse(raw); } catch { /* fall back to permissive unquoting */ }
  }
  return raw.replace(/^['"]|['"]$/g, '');
}

module.exports = { decodeFrontmatterScalar };
