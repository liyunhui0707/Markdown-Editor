const {test,before}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const asar=require('@electron/asar'),{verifyDocumentRelease}=require('../tools/verify-document-release.cjs');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,id=require('../electron-builder.document.cjs').appId;
let app,fixture;const team='TESTTEAM01';
const signature=`CodeDirectory v=20500 size=400 flags=0x10000(runtime) hashes=4+3\nAuthority=Developer ID Application: Synthetic (${team})\nTeamIdentifier=${team}\nTimestamp=Nov 8, 2026 at 10:00:00\n`;
before(async()=>{
 fixture=await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-release-'));app=path.join(fixture,'Synthetic.app');
 await fs.mkdir(path.join(app,'Contents/Resources'),{recursive:true});await fs.writeFile(path.join(app,'Contents/Info.plist'),'synthetic plist');
 await fs.writeFile(path.join(app,'Contents/Resources/document-save'),'synthetic helper');
 const source=path.join(fixture,'asar-source');await fs.mkdir(source);await fs.writeFile(path.join(source,'package.json'),JSON.stringify({version,main:'document-app-main.js'}));
 await asar.createPackage(source,path.join(app,'Contents/Resources/app.asar'));
});
function probe({appSignature=signature,helperSignature=signature,plist={},failure}={}){
 const calls=[];return {calls,run:(command,args)=>{
  const step=path.basename(command);calls.push({step,args});if(failure?.(step,args))throw Error('synthetic verification rejection');
  if(step==='plutil')return JSON.stringify({CFBundleIdentifier:id,CFBundleShortVersionString:version,...plist});
  if(step==='codesign'&&args.includes('--display'))return args.at(-1)===app?appSignature:helperSignature;
  return '';
 }};
}
test('release build rejects absent, ad-hoc and development certificate identities before building',()=>{
 for(const identity of ['', '-', 'Apple Development: Synthetic (TESTTEAM01)', 'Developer ID Application: Bad\nName (TESTTEAM01)']){
  const r=spawnSync(process.execPath,['-e',"require('./electron-builder.document-release.cjs')"],{cwd:root,encoding:'utf8',env:{DOCUMENT_SIGNING_IDENTITY:identity}});
  assert.notEqual(r.status,0);assert.match(r.stderr,/Developer ID Application certificate/);
 }
});
test('distribution config preserves product identity and packaging while requiring the native helper signature',async()=>{
 const r=spawnSync(process.execPath,['-e',"console.log(JSON.stringify(require('./electron-builder.document-release.cjs')))"],{cwd:root,encoding:'utf8',env:{DOCUMENT_SIGNING_IDENTITY:'Developer ID Application: Synthetic (TESTTEAM01)'}});
 assert.equal(r.status,0,r.stderr);const config=JSON.parse(r.stdout),base=require('../electron-builder.document.cjs');
 assert.equal(config.appId,base.appId);assert.deepEqual(config.files,base.files);assert.deepEqual(config.extraResources,base.extraResources);
 assert.equal(config.mac.identity,'Synthetic (TESTTEAM01)');assert.equal(config.mac.type,'distribution');assert.equal(config.forceCodeSigning,true);
 assert.equal(config.mac.hardenedRuntime,true);assert.equal(config.mac.strictVerify,true);assert.deepEqual(config.mac.binaries,['Contents/Resources/document-save']);
 assert.equal(config.mac.notarize,false);assert.equal(base.mac.identity,null);
 assert.equal(config.directories.output,'dist/signed');
 await require('app-builder-lib/out/util/config/config').validateConfiguration(config,{isEnabled:false});
});
test('release verifier requires both signatures, stapled ticket and Gatekeeper in order (synthetic tools)',()=>{
 const p=probe();const result=verifyDocumentRelease(app,team,p);assert.equal(result.ok,true);
 assert.deepEqual(p.calls.map(x=>x.step),['plutil','codesign','codesign','codesign','codesign','xcrun','spctl']);
 assert.deepEqual(p.calls.at(-2).args,['stapler','validate',app]);assert.equal(result.version,version);
});
for(const [name,metadata] of [
 ['ad-hoc',signature.replace(/^Authority=.+\n/m,'')],['wrong team',signature.replace('TeamIdentifier='+team,'TeamIdentifier=OTHERTEAM0')],
 ['missing Hardened Runtime',signature.replace('0x10000(runtime)','0x0(none)')],['missing timestamp',signature.replace(/^Timestamp=.+\n/m,'')],
])test('release verifier rejects '+name+' before notarization assessment',()=>{
 const p=probe({appSignature:metadata});assert.throws(()=>verifyDocumentRelease(app,team,p),/Developer ID signature/);
 assert(!p.calls.some(x=>x.step==='xcrun'||x.step==='spctl'));
});
test('release verifier refuses an unsigned native helper even when the app is signed',()=>{
 const p=probe({helperSignature:'Signature=adhoc'});assert.throws(()=>verifyDocumentRelease(app,team,p),/Save helper/);assert(!p.calls.some(x=>x.step==='xcrun'));
});
for(const failure of ['codesign','xcrun','spctl'])test('release verifier propagates '+failure+' failure without returning success',()=>{
 const p=probe({failure:s=>s===failure});assert.throws(()=>verifyDocumentRelease(app,team,p),/synthetic verification rejection/);
 assert.equal(p.calls.at(-1).step,failure);
});
test('release verifier rejects wrong version or bundle identity before signature work',()=>{
 for(const plist of [{CFBundleIdentifier:'other.app'},{CFBundleShortVersionString:'0.0.1'}]){
  const p=probe({plist});assert.throws(()=>verifyDocumentRelease(app,team,p),/does not match/);assert.equal(p.calls.length,1);
 }
});
test('release verifier rejects symbolic-link bundle input without executing tools',async()=>{
 const link=path.join(fixture,'Alias.app');await fs.symlink(app,link);const p=probe();assert.throws(()=>verifyDocumentRelease(link,team,p),/non-symlink/);assert.equal(p.calls.length,0);
});
