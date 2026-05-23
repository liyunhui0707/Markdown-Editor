/* Phase A — utilities for the Claude importer.
   Ported verbatim from Local-Web-Server/tools/import-claude.js (lines 10–42,
   622–632). ESM exports converted to CommonJS module.exports. No algorithm
   change. */

'use strict';

const path = require('node:path');
const os   = require('node:os');

const PROJECT_NAME_RE = /^[-A-Za-z0-9._]+$/;
const SESSION_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

const TOOL_INPUT_MAX  = 4096;
const TOOL_RESULT_MAX = 4096;

function parseRawFlag(v) {
  if (typeof v !== 'string') return false;
  const norm = v.trim().toLowerCase();
  return norm === '1' || norm === 'true';
}

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (typeof p === 'string' && p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function isForbiddenPath(p) {
  return p === '/' || p === os.homedir();
}

function assertSafeInt(name, value, { min, max }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer, got: ${JSON.stringify(value)}`);
  }
  if (value < min || value > max) {
    throw new Error(`${name} must be in [${min}, ${max}], got: ${value}`);
  }
}

function parseMaxBytesEnv(raw) {
  if (raw === undefined || raw === '') return 52428800;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`SESSION_IMPORT_MAX_BYTES must be an integer, got: ${JSON.stringify(raw)}`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`SESSION_IMPORT_MAX_BYTES must be a positive safe integer, got: ${n}`);
  }
  return n;
}

module.exports = {
  PROJECT_NAME_RE,
  SESSION_FILE_RE,
  TOOL_INPUT_MAX,
  TOOL_RESULT_MAX,
  parseRawFlag,
  expandHome,
  isForbiddenPath,
  assertSafeInt,
  parseMaxBytesEnv,
};
