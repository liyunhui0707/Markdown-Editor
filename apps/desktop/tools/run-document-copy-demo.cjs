'use strict';
// Explicit development entry. Keep the reviewed cwd-bound create capability;
// never chdir a running Electron process or accept a user-supplied directory.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
if (process.platform !== 'darwin' || (process.argv.length !== 2 && !(process.argv.length === 3 && process.argv[2] === '--persistent'))) throw Error('macOS development launcher; no arguments accepted');
const electron = require('electron');
if (typeof electron !== 'string' || !fs.statSync(electron).isFile()) throw Error('Installed Electron runtime required');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'document-safe-create-')));
fs.chmodSync(root, 0o700);
console.log('Disposable Markdown test copies: ' + root);
const env = {}; for (const key of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG']) if (process.env[key]) env[key] = process.env[key];
const child = spawn(electron, [path.resolve(__dirname, '../main.js'), '--document-readonly', process.argv[2] === '--persistent' ? '--document-persistent-copy' : '--document-test-copy'],
  { cwd: root, env, stdio: 'inherit' });
child.on('error', () => { console.error('Unable to launch the restricted document window. Test directory retained.'); process.exitCode = 1; });
child.on('close', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
// No automatic deletion: even uncertain/partial copies remain available for inspection.
