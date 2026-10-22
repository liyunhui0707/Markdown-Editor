// Test-only entry: isolate Electron before the real main module captures paths.
const { app, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const rootArg = argument('e2e-root');
const phase = argument('e2e-phase');
if (!rootArg || !['edit', 'reopen'].includes(phase)) throw new Error('Missing E2E launch arguments');
const root = fs.realpathSync(rootArg);
if (path.dirname(root) !== fs.realpathSync(os.tmpdir())
    || !path.basename(root).startsWith('markdown-vault-e2e-')) {
  throw new Error('E2E requires its own temporary directory');
}
const profile = path.join(root, `profile-${phase}`);
fs.mkdirSync(profile); // Fail if a stale profile would be reused.
app.setName('Markdown Vault E2E');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const crashes = path.join(profile, 'crashes');
fs.mkdirSync(crashes);
app.setPath('crashDumps', crashes);
app.commandLine.appendSwitch('disable-background-networking');
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
});

require('../main.js');
