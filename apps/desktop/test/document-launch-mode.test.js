const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLaunchMode } = require('../lib/document-launch-mode');
const base = { packaged: false, mas: false, platform: 'darwin', argv: [] };
test('fixed product entry enables only the existing new-file workflow', () => {
  assert.deepEqual(resolveLaunchMode({ ...base, product: true, packaged: true }),
    { readOnlyWindow: true, persistentCopies: true, testCopies: true, drafts: true });
});
test('packaged demo and product test overrides fail closed', () => {
  assert.throws(() => resolveLaunchMode({ ...base, packaged: true, argv: ['--document-persistent-copy'] }));
  for (const flag of ['--document-readonly', '--document-no-drafts', '--document-test-copy', '--document-drafts-test-root=/tmp/other'])
    assert.throws(() => resolveLaunchMode({ ...base, product: true, packaged: true, argv: [flag] }));
});
test('ordinary demo still requires explicit development copy authority', () => {
  assert.equal(resolveLaunchMode({ ...base, argv: ['--document-readonly'] }).persistentCopies, false);
  assert.equal(resolveLaunchMode({ ...base, argv: ['--document-readonly', '--document-persistent-copy'] }).persistentCopies, true);
  assert.equal(resolveLaunchMode({ ...base, argv: ['--document-persistent-copy'] }).testCopies, false);
});
test('unsupported platform and MAS product entry are refused', () => {
  assert.throws(() => resolveLaunchMode({ ...base, product: true, mas: true }));
  assert.throws(() => resolveLaunchMode({ ...base, product: true, platform: 'linux' }));
});

test('document package includes shared runtime and excludes legacy and private trees', () => {
  const path = require('node:path');
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
  const config = require('../electron-builder.document.cjs');
  const root = path.resolve(__dirname, '..'), dest = path.join(root, 'dist', 'document-policy-test');
  const info = { config, projectDir: root, buildResourcesDir: 'build', isPrepackedAppAsar: false, debugLogger: { isEnabled: false } };
  const filter = getMainFileMatchers(root, dest, value => value, config.mac, { info }, path.join(root, 'dist'), false)[0].createFilter();
  const has = file => filter(path.join(root, file), { isDirectory: () => false });
  for (const file of ['document-app-main.js', 'package.json', 'lib/document-window-main.js', 'lib/document-demo-preload.js',
    'lib/document-demo.html', 'lib/document-demo-bundle.js', 'lib/document-copy-writer.js', 'lib/document-launch-mode.js',
    'lib/document-source-map.mjs', 'lib/document-writing-shell.css', 'lib/editor-path-policy.js']) assert.equal(has(file), true, file);
  for (const file of ['main.js', 'index.html', 'preload.js', 'lib/cm6-bundle.js', 'lib/spike-cm6-bundle.js',
    'lib/document-demo-entry.js', 'lib/document-demo-main.js', 'lib/.env', 'lib/secrets/sample.json', '.local/backups/sample', 'tools/launcher.cjs',
    'e2e/test.cjs', 'lib/session-viewer/private.js']) assert.equal(has(file), false, file);
  assert.equal(config.extraMetadata.main, 'document-app-main.js');
});
