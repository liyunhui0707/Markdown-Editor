'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const deny = code => { throw Object.assign(Error(code.replaceAll('-', ' ')), { code, status: 'blocked' }); };
function directoryHelperPath(root = path.resolve(__dirname, '..')) {
  return path.basename(root) === 'app.asar'
    ? path.join(path.dirname(root), 'document-save') : path.join(root, 'build/document-save');
}
function inspectDirectoryLocation(directory, { spawn = spawnSync } = {}) {
  const result = spawn(directoryHelperPath(), ['--inspect-directory', directory], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 4096, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }
  });
  if (result.error || result.signal || result.status !== 0) return deny('directory-location-unavailable');
  let proof;
  try { proof = JSON.parse(result.stdout); } catch { return deny('directory-location-unavailable'); }
  if (proof?.ok === false && proof.code === 'cloud-directory') return deny('cloud-directory');
  if (proof?.ok !== true || proof.ubiquitous !== false || Object.keys(proof).length !== 2) return deny('directory-location-unavailable');
  return { ubiquitous: false };
}
module.exports = { inspectDirectoryLocation, directoryHelperPath };
