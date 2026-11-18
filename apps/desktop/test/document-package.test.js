const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {runtimeFilter,packageOptions}=require('../tools/document-package-policy.cjs');
const {electronNotices}=require('../tools/package-document.cjs');
const root=path.resolve(__dirname,'..'),lock=require('../package-lock.json');
test('actual Document copy filter includes required runtime and rejects private, legacy and development inputs',()=>{
 const include=runtimeFilter(root,lock);
 for(const file of ['package.json','document-app-main.js','lib/document-demo-bundle.js','lib/document-window-main.js',
  'lib/document-demo-preload.js','lib/document-demo.html','lib/document-writing-shell.css','lib/editor-path-policy.js',
  'node_modules/unified/index.js','node_modules/remark-parse/index.js'])assert(include(path.join(root,file)),file);
 for(const file of ['main.js','index.html','lib/cm6-bundle.js','lib/document-demo-entry.js','lib/document-demo-main.js',
  '.local/private.json','tools/canary.cjs','test/canary.js','node_modules/@toast-ui/editor/dist/toastui-editor.js',
  'node_modules/@playwright/test/index.js','node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'])assert(!include(path.join(root,file)),file);
 for(const prefix of ['','lib/','node_modules/unified/'])for(const file of ['.env','.env.production','secrets/canary.json',
  '.git/config','.local/private.json','Inbox/canary.md','test/canary.js','e2e/canary.js'])assert(!include(path.join(root,prefix,file)),prefix+file);
 assert(!include(path.resolve(root,'../outside')));assert(!include(path.join(root,'lib/document-private/.env')));
});
test('release packaging requires complete Electron notices and refuses missing, empty or linked notices',()=>{
 const fs=require('node:fs'),os=require('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'document-package-notices-'));
 assert.throws(()=>electronNotices(dir));fs.writeFileSync(path.join(dir,'LICENSE'),'Electron license canary');
 fs.writeFileSync(path.join(dir,'LICENSES.chromium.html'),'');assert.throws(()=>electronNotices(dir));
 fs.writeFileSync(path.join(dir,'LICENSES.chromium.html'),'Chromium notices canary');
 const notices=electronNotices(dir);assert.equal(notices['LICENSE.electron.txt'].toString(),'Electron license canary');
 assert.equal(notices['LICENSES.chromium.html'].toString(),'Chromium notices canary');
 const linked=fs.mkdtempSync(path.join(os.tmpdir(),'document-package-notices-link-'));fs.symlinkSync(path.join(dir,'LICENSE'),path.join(linked,'LICENSE'));
 assert.throws(()=>electronNotices(linked));
});
test('packager metadata preserves installed identity, Markdown association, helper and explicit local signature',()=>{
 const o=packageOptions({root,out:'/private/tmp/document-package-policy',lock});
 assert.equal(o.appBundleId,'com.markdownvault.document.dev');assert.equal(o.name,'Markora');
 assert.equal(o.arch,'arm64');assert.equal(o.platform,'darwin');assert.equal(o.overwrite,false);assert.equal(o.asar,true);
 assert.equal(o.extendInfo.LSMinimumSystemVersion,'12.0');
 assert.deepEqual(o.extendInfo.CFBundleDocumentTypes,[{CFBundleTypeName:'Markdown document',CFBundleTypeExtensions:['md'],CFBundleTypeRole:'Editor',LSHandlerRank:'Alternate'}]);
 assert.deepEqual(o.extraResource,[path.join(root,'build/document-save')]);assert.equal(o.osxSign.identity,'-');
 assert.equal(o.osxNotarize,undefined);assert.equal(o.derefSymlinks,false);
});
test('signed packager mode refuses absent or development identity before any packaging',()=>{
 for(const identity of ['', '-', 'Apple Development: Synthetic (TESTTEAM01)','Developer ID Application: Bad\nName (TESTTEAM01)'])
  assert.throws(()=>packageOptions({root,out:'/private/tmp/document-package-policy',lock,signed:true,identity}),/Developer ID Application/);
 const o=packageOptions({root,out:'/private/tmp/document-package-policy',lock,signed:true,identity:'Developer ID Application: Synthetic (TESTTEAM01)'});
 assert.equal(o.osxSign.identity,'Developer ID Application: Synthetic (TESTTEAM01)');
 assert.equal(o.osxSign.type,'distribution');assert.equal(o.osxSign.optionsForFile().hardenedRuntime,true);
 assert.equal(o.osxSign.optionsForFile().entitlements,path.join(root,'build/entitlements.mac.plist'));
 assert.equal(o.osxSign.continueOnError,false);assert.equal(o.osxNotarize,undefined);
});
