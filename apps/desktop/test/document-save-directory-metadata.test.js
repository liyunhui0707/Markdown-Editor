'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { inspectMacMetadata } = require('../lib/document-save-policy');
// Exercise real metadata parsing with bounded synthetic native-command replies.
const protection = ' 0: group:everyone deny delete';
function inspect({ acl = protection, directory = true, marker = '@', names = 'com.apple.macl\n', hex = '01 02 AB\n', flags = '0\n', ...options } = {}) {
  const calls = [];
  const spawn = (exe, args, config) => {
    calls.push([exe, args]);
    assert.equal(config.timeout, 2000); assert.equal(config.env.LC_ALL, 'C');
    const stdout = exe === '/bin/ls' ? `${directory ? 'd' : '-'}rwx------${marker} 1 owner group 0 Jan 1 00:00 synthetic\n${acl ? acl + '\n' : ''}`
      : exe === '/usr/bin/stat' ? flags : args[0] === '-px' ? hex : names;
    return { status: 0, stdout };
  };
  const state = inspectMacMetadata('/synthetic', { spawn, platform: 'darwin', ...options });
  return { state, calls };
}
test('directory-only opt-in accepts exact non-inheriting everyone deny-delete and opaque MACL fingerprint', () => {
  for (const acl of [protection, ' 0: ABCDEFAB-CDEF-ABCD-EFAB-CDEF0000000C deny delete']) {
    const { state } = inspect({ acl, newFileDirectory: true });
    assert.notEqual(state.acl, false);
    assert.equal(state.xattrs['com.apple.macl'], createHash('sha256').update(Buffer.from('0102ab', 'hex')).digest('hex'));
    assert.notDeepEqual(state, inspect({ acl, newFileDirectory: true, hex: '01 02 AC\n' }).state);
  }
});
test('ordinary directories can opt in without any ACL or MACL', () => {
  assert.deepEqual(inspect({ acl: '', names: '', marker: ' ', newFileDirectory: true }).state, { acl: false, flags: '0', xattrs: {} });
});
test('strict save/file inspection is unchanged even when directory opt-in is requested for a file', () => {
  for (const options of [{}, { directory: false, newFileDirectory: true }]) {
    assert.throws(() => inspect(options), { code: 'unsupported-acl' });
    assert.throws(() => inspect({ ...options, acl: '' }), { code: 'unsupported-xattrs' });
  }
});
for (const acl of [
  ' 0: group:everyone allow delete', ' 0: group:everyone deny delete_child',
  ' 0: group:everyone deny delete,add_file', ' 0: group:everyone inherited deny delete',
  ' 0: group:everyone deny delete,file_inherit', ' 0: group:everyone deny delete,directory_inherit',
  ' 0: user:someone deny delete', ' 1: group:everyone deny delete',
  protection + '\n 1: group:everyone allow write', protection + '\n' + protection,
  protection + '\n unrecognized metadata', '',
]) test('directory opt-in still rejects non-allowlisted ACL: ' + JSON.stringify(acl), () => {
  assert.throws(() => inspect({ acl, marker: '+', newFileDirectory: true }), { code: 'unsupported-acl' });
});
test('directory opt-in refuses unknown xattrs, flags and malformed metadata', () => {
  for (const names of ['com.apple.quarantine\n', 'com.apple.macl\ncom.example.other\n', 'com.apple.macl\ncom.apple.macl\n', 'com.apple.macl']) {
    assert.throws(() => inspect({ names, newFileDirectory: true }), { code: 'unsupported-xattrs' });
  }
  assert.throws(() => inspect({ flags: '32768\n', newFileDirectory: true }), { code: 'unsupported-flags' });
  assert.throws(() => inspect({ hex: 'not hex', newFileDirectory: true }), { code: 'metadata-inspection-unavailable' });
});

test('unsupported directory never becomes the suggested save location', () => {
  const { suggestCopyPath } = require('../lib/document-save-policy');
  for (const root of [undefined, '/not-a-home-child', require('node:os').homedir(), require('node:os').tmpdir()]) assert.equal(suggestCopyPath(root), 'Untitled.md');
});


test('newly created persistent files accept only observed native MACL and last-used metadata', () => {
  const options = { directory: false, acl: '', newlyCreatedFile: true,
    names: 'com.apple.macl\ncom.apple.lastuseddate#PS\ncom.apple.provenance\n' };
  const a = inspect(options).state;
  assert.deepEqual(Object.keys(a.xattrs), ['com.apple.lastuseddate#PS', 'com.apple.macl', 'com.apple.provenance']);
  assert.notDeepEqual(a, inspect({ ...options, hex: '01 02 AC\n' }).state);
  assert.throws(() => inspect({ ...options, newlyCreatedFile: false }), { code: 'unsupported-xattrs' });
  assert.throws(() => inspect({ ...options, directory: true }), { code: 'unsupported-xattrs' });
  assert.throws(() => inspect({ ...options, acl: protection }), { code: 'unsupported-acl' });
  assert.throws(() => inspect({ ...options, names: options.names + 'com.apple.quarantine\n' }), { code: 'unsupported-xattrs' });
});
