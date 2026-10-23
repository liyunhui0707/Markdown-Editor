'use strict';
const nativeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const deny = code => { throw Object.assign(Error(code.replaceAll('-', ' ')), { code, status: 'blocked' }); };

function inspectMacMetadata(filePath, { spawn = spawnSync, platform = process.platform } = {}) {
  if (platform !== 'darwin') return deny('metadata-inspection-unavailable');
  function command(executable, args) {
    const result = spawn(executable, args, { encoding: 'utf8', timeout: 2000, maxBuffer: 128 * 1024,
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
    if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string') {
      return deny('metadata-inspection-unavailable');
    }
    return result.stdout; // Never return command output or metadata values in errors/logs.
  }
  const listing = command('/bin/ls', ['-lde', filePath]);
  if (!/^[-d][rwxstST-]{9}[@+ ]/.test(listing)) return deny('metadata-inspection-unavailable');
  if (listing[10] === '+' || /^\s*\d+:/m.test(listing)) return deny('unsupported-acl');
  const flags = command('/usr/bin/stat', ['-f', '%f', filePath]).trim();
  if (!/^\d+$/.test(flags)) return deny('metadata-inspection-unavailable');
  if (BigInt(flags) !== 0n) return deny('unsupported-flags');
  const names = command('/usr/bin/xattr', [filePath]);
  if (names !== '' && (!names.endsWith('\n') || names.slice(0, -1).split('\n').some(name => !name))) return deny('unsupported-xattrs');
  const attributes = names === '' ? [] : names.slice(0, -1).split('\n');
  if (new Set(attributes).size !== attributes.length) return deny('unsupported-xattrs');
  if (attributes.some(name => name !== 'com.apple.provenance')) return deny('unsupported-xattrs');
  const xattrs = {};
  for (const name of attributes) {
    const hex = command('/usr/bin/xattr', ['-px', name, filePath]).replace(/\s/g, '');
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) return deny('metadata-inspection-unavailable');
    xattrs[name] = createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
  }
  return { acl: false, flags, xattrs };
}

function createSavePolicy({ fs = nativeFs, unsafeExperimentalRoot } = {}) {
  let rootIdentity;
  function scope(filePath) {
    if (unsafeExperimentalRoot === undefined) return deny('coordination-required');
    if (typeof unsafeExperimentalRoot !== 'string' || !path.isAbsolute(unsafeExperimentalRoot)) return deny('experimental-scope-required');
    const root = fs.realpathSync(unsafeExperimentalRoot);
    const stat = fs.lstatSync(unsafeExperimentalRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid()
        || (stat.mode & 0o777) !== 0o700 || root !== unsafeExperimentalRoot
        || path.dirname(root) !== fs.realpathSync(os.tmpdir())
        || path.dirname(filePath) !== root || fs.realpathSync(path.dirname(filePath)) !== root) return deny('experimental-scope-required');
    const identity = `${stat.dev}:${stat.ino}`;
    if (rootIdentity && rootIdentity !== identity) return deny('experimental-scope-changed');
    rootIdentity = identity;
    // This only confines experiments to their original tmp filesystem. It is
    // NOT an allowlist of production/cloud/network filesystem semantics.
    if (fs.statfsSync(filePath).type !== fs.statfsSync(root).type || fs.statSync(filePath).dev !== stat.dev) {
      return deny('unsupported-filesystem');
    }
    return root;
  }
  function capture(filePath) {
    const root = scope(filePath);
    return { file: inspectMacMetadata(filePath), directory: inspectMacMetadata(root) };
  }
  function verify(filePath, baseline) {
    const now = capture(filePath);
    if (JSON.stringify(now) !== JSON.stringify(baseline)) return deny('metadata-changed');
  }
  return { capture, verify, safety: 'experimental-uncoordinated', realFileSafe: false };
}
module.exports = { createSavePolicy, inspectMacMetadata };
