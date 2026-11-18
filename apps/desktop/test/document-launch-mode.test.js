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

test('document copy policy retains the product entry and excludes legacy and retired dependencies',()=>{
 const path=require('node:path'),root=path.resolve(__dirname,'..');
 const include=require('../tools/document-package-policy.cjs').runtimeFilter(root,require('../package-lock.json'));
 for(const n of ['document-app-main.js','package.json','lib/document-window-main.js','lib/document-demo-preload.js','lib/document-demo.html','lib/document-demo-bundle.js','lib/editor-path-policy.js'])assert(include(path.join(root,n)),n);
 for(const n of ['main.js','index.html','lib/document-demo-entry.js','lib/document-demo-main.js','lib/cm6-bundle.js','.local/private','tools/launcher.cjs'])assert(!include(path.join(root,n)),n);
 assert.equal(require('../package.json').main,'document-app-main.js');
});
test('Document dependency policy excludes retired Toast UI while retaining its current parser',()=>{
 const path=require('node:path'),root=path.resolve(__dirname,'..');
 const include=require('../tools/document-package-policy.cjs').runtimeFilter(root,require('../package-lock.json'));
 for(const n of ['node_modules/@toast-ui/editor/dist/toastui-editor.js','node_modules/@toast-ui/toastmark/dist/toastmark.js'])assert(!include(path.join(root,n)),n);
 for(const n of ['node_modules/unified/index.js','node_modules/remark-parse/index.js','node_modules/remark-gfm/index.js'])assert(include(path.join(root,n)),n);
});
