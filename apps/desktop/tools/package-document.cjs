'use strict';
// Official Electron Packager; fixed Document product and arm64 macOS output.
// No upload, notarization, automatic certificate discovery or target overwrite.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {packageOptions}=require('./document-package-policy.cjs');
const root=path.resolve(__dirname,'..'),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function electronNotices(extracted){
 return Object.fromEntries([['LICENSE','LICENSE.electron.txt'],['LICENSES.chromium.html','LICENSES.chromium.html']].map(([from,to])=>{
  const p=path.join(extracted,from),s=fs.lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink()&&s.size>0,'Missing or unsafe Electron notice: '+from);
  return [to,fs.readFileSync(p)];
 }));
}
function command(binary,args){const r=spawnSync(binary,args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw Error(path.basename(binary)+' failed: '+(r.error?.message||r.stderr));return r.stdout;}
function argumentsFor(argv){
 const options={zip:false,signed:false,out:path.join(root,'dist')};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(a==='--zip')options.zip=true;else if(a==='--signed')options.signed=true;
  else if(a==='--out'||a==='--electron-zip-dir'){if(!argv[i+1]||!path.isAbsolute(argv[i+1]))throw Error(a+' requires an absolute path');options[a==='--out'?'out':'electronZipDir']=argv[++i];}
  else throw Error('Unknown packaging argument: '+a);
 }
 if(options.signed&&options.out===path.join(root,'dist'))options.out=path.join(root,'dist/signed');
 return options;
}
async function packageDocument(argv){
 if(process.platform!=='darwin'||Number(process.versions.node.split('.')[0])!==24)throw Error('Package on macOS with the pinned Node 24 runtime.');
 const cli=argumentsFor(argv),pkg=JSON.parse(fs.readFileSync(root+'/package.json')),lock=JSON.parse(fs.readFileSync(root+'/package-lock.json'));
 const opts=packageOptions({root,lock,...cli,identity:process.env.DOCUMENT_SIGNING_IDENTITY||''});
 const out=path.resolve(cli.out);assert(!['/',os.homedir(),os.tmpdir(),root,path.dirname(root)].includes(out),'Choose a dedicated output directory');
 if(fs.existsSync(out)){const s=fs.lstatSync(out);assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid());}
 const target=path.join(out,opts.name+'-darwin-arm64'),archive=path.join(out,`${opts.name}-${pkg.version}-arm64-mac.zip`),receipt=path.join(out,'package-receipt.json');
 for(const p of [target,archive,receipt])assert(!fs.existsSync(p),'Refusing existing output: '+p);
 const helper=root+'/build/document-save';assert(fs.statSync(helper).isFile());const helperBefore=sha(helper);
 const probe=spawnSync(helper,[],{input:'{"testPoint":"before-swap"}\n',encoding:'utf8'});assert.equal(probe.status,64,'Never package a test helper');
 opts.afterCopy=[async({buildPath:build})=>{
  const metadata={name:pkg.name,version:pkg.version,description:pkg.description,main:'document-app-main.js',license:pkg.license,
   dependencies:Object.fromEntries(Object.entries(pkg.dependencies).filter(([n])=>!n.startsWith('@toast-ui/')))};
  fs.writeFileSync(path.join(build,'package.json'),JSON.stringify(metadata,null,2)+'\n');
  fs.copyFileSync(path.join(root,'../../LICENSE'),path.join(build,'LICENSE'));
 }];
 let notices;
 opts.afterExtract=[async({buildPath})=>{notices=electronNotices(buildPath);}];
 opts.afterCopyExtraResources=[async({buildPath:build})=>{
  const resources=path.join(build,opts.name+'.app/Contents/Resources');assert.equal(sha(path.join(resources,'document-save')),helperBefore);
  for(const [name,bytes]of Object.entries(notices))fs.writeFileSync(path.join(resources,name),bytes,{flag:'wx'});
 }];
 if(cli.electronZipDir){
  const name=`electron-v${opts.electronVersion}-darwin-arm64.zip`,expected=require('electron/checksums.json')[name];
  assert(expected&&sha(path.join(cli.electronZipDir,name))===expected,'Offline Electron ZIP must match the locked official checksum');opts.electronZipDir=cli.electronZipDir;
 }
 const {packager}=await import('@electron/packager');const outputs=await packager(opts);
 assert.equal(outputs.length,1);const app=path.join(outputs[0],opts.name+'.app'),contents=path.join(app,'Contents');
 command('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 command('/usr/bin/codesign',['--verify','--strict',path.join(contents,'Resources/document-save')]);
 const asar=require('@electron/asar'),asarPath=path.join(contents,'Resources/app.asar');
 const packaged=JSON.parse(asar.extractFile(asarPath,'package.json'));assert.equal(packaged.version,pkg.version);assert.equal(packaged.main,'document-app-main.js');
 const plist=JSON.parse(command('/usr/bin/plutil',['-convert','json','-o','-',path.join(contents,'Info.plist')]));
 assert.equal(plist.CFBundleIdentifier,opts.appBundleId);assert.equal(plist.CFBundleShortVersionString,pkg.version);
 assert.deepEqual(plist.CFBundleDocumentTypes,opts.extendInfo.CFBundleDocumentTypes);
 assert.equal(sha(path.join(contents,'Resources',plist.CFBundleIconFile)),sha(path.join(root,'build/document.icns')));
 if(cli.signed)for(const binary of [app,path.join(contents,'Resources/document-save')]){
  const metadata=spawnSync('/usr/bin/codesign',['--display','--verbose=4',binary],{encoding:'utf8'});
  assert.equal(metadata.status,0);assert.match(metadata.stderr,/^Authority=Developer ID Application: /m);
  assert.match(metadata.stderr,/^Timestamp=.+/m);assert.match(metadata.stderr,/flags=.*\bruntime\b/);
  assert(metadata.stderr.split(/\r?\n/).includes('TeamIdentifier='+process.env.DOCUMENT_SIGNING_IDENTITY.slice(-11,-1)));
 }
 const result={version:pkg.version,app,asarSha256:sha(asarPath),helperBuildSha256:helperBefore,helperSha256:sha(path.join(contents,'Resources/document-save')),
  arch:'arm64',electron:opts.electronVersion,signing:cli.signed?'Developer ID Application':'ad-hoc',notarized:false,sourceFiles:{}};
 result.notices={};for(const [name,bytes]of Object.entries(notices)){const expected=createHash('sha256').update(bytes).digest('hex');assert.equal(sha(path.join(contents,'Resources',name)),expected);result.notices[name]=expected;}
 for(const n of ['document-app-main.js','lib/editor-path-policy.js',...fs.readdirSync(root+'/lib').filter(n=>n.startsWith('document-')&&!['document-demo-entry.js','document-demo-main.js'].includes(n)).map(n=>'lib/'+n)]){
  const h=sha(path.join(root,n));assert.equal(createHash('sha256').update(asar.extractFile(asarPath,n)).digest('hex'),h,n);result.sourceFiles[n]=h;
 }
 assert(!asar.listPackage(asarPath).some(n=>/\/(?:\.local|secrets|test|tests|e2e|tools|\.env)(?:\/|$)|\/node_modules\/(?:@toast-ui|picomatch|electron-builder)(?:\/|$)/.test(n)));
 if(cli.zip){command('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);result.zip=archive;result.zipSha256=sha(archive);}
 fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...result,sourceFiles:Object.keys(result.sourceFiles).length}));return result;
}
module.exports={argumentsFor,packageDocument,electronNotices};
if(require.main===module)packageDocument(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
