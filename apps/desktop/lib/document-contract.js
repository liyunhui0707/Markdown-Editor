'use strict';
const { isProxy } = require('node:util').types;

// Session API payloads are data, never getters, arrays or implicit revisions.
function record(value, allowed) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) return false;
    if (![null, Object.prototype].includes(Object.getPrototypeOf(value))) return false;
    const fields = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(fields).every(key => typeof key === 'string'
      && allowed.includes(key) && Object.hasOwn(fields[key], 'value'));
  } catch { return false; }
}
function failure(code, fields = {}) {
  return { ok: false, status: 'blocked', code, error: code.replaceAll('-', ' '), committed: false, ...fields };
}
function revisionError(value, current) {
  if (value === undefined) return null; // Optional local API check, not an IPC protocol.
  if (!Number.isSafeInteger(value) || value < 0) return 'invalid-revision';
  return value === current ? null : 'stale-revision';
}
module.exports = { record, failure, revisionError };
