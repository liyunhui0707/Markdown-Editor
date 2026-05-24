/* Phase A.2 — utilities for the Codex importer.
   Ported verbatim from Local-Web-Server/tools/import-codex.js (commit
   4bb2eb3) lines 29–96 (constants + small helpers) and lines 857–882
   (parseMaxBytesEnv + parseRawFlag). ESM exports → CommonJS module.exports.
   No algorithm change. */

'use strict';

const path = require('node:path');
const os   = require('node:os');

const TOOL_INPUT_MAX  = 4096;
const TOOL_RESULT_MAX = 4096;

// Source-traversal allowlists (lines 91–98). UUID body is lowercase hex
// with no version pinning; real Codex IDs are UUIDv7-shaped, so pinning
// [1-5] would reject every real session.
const YEAR_RE  = /^\d{4}$/;
const MONTH_RE = /^(0[1-9]|1[0-2])$/;
const DAY_RE   = /^(0[1-9]|[12]\d|3[01])$/;
const ROLLOUT_FILE_RE =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

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
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value)
  ) {
    throw new Error(`${name} must be an integer, got: ${JSON.stringify(value)}`);
  }
  if (value < min || value > max) {
    throw new Error(`${name} must be in [${min}, ${max}], got: ${value}`);
  }
}

function jsonScalar(value) {
  return JSON.stringify(String(value));
}

function buildFence(content) {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 96) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function truncate(s, max) {
  if (s.length <= max) return { rendered: s, truncated: false };
  return { rendered: s.slice(0, max), truncated: true };
}

// Extract the UUID-shaped portion of a rollout filename.
function extractSessionId(fileName) {
  const m = fileName.match(
    /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
  );
  return m ? m[1] : '';
}

function parseMaxBytesEnv(raw) {
  if (raw === undefined || raw === '') return 52428800;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(
      `SESSION_IMPORT_MAX_BYTES must be an integer, got: ${JSON.stringify(raw)}`,
    );
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(
      `SESSION_IMPORT_MAX_BYTES must be a positive safe integer, got: ${n}`,
    );
  }
  return n;
}

function parseRawFlag(v) {
  if (typeof v !== 'string') return false;
  const norm = v.trim().toLowerCase();
  return norm === '1' || norm === 'true';
}

module.exports = {
  TOOL_INPUT_MAX,
  TOOL_RESULT_MAX,
  YEAR_RE,
  MONTH_RE,
  DAY_RE,
  ROLLOUT_FILE_RE,
  expandHome,
  isForbiddenPath,
  assertSafeInt,
  jsonScalar,
  buildFence,
  truncate,
  extractSessionId,
  parseMaxBytesEnv,
  parseRawFlag,
};
