'use strict';
// Isolated disk-image acceptance. Never enumerates or detaches physical disks.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {createOriginalSave}=require('../lib/document-original-save'),{createDocumentFileStore}=require('../lib/document-file-store');
if(process.platform!=='darwin')throw Error('macOS APFS acceptance required');
const evidence=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'markdown-cross-volume-evidence-'));
const image=path.join(evidence,'synthetic.sparseimage'),mount=path.join('/private/tmp',path.basename(evidence)+'-mount'),binary=process.env.DOCUMENT_NATIVE_SAVE_TEST_BINARY;
if(!binary||!path.isAbsolute(binary))throw Error('test helper required');
const command=(exe,args)=>{const r=spawnSync(exe,args,{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});if(r.error||r.status!==0)throw Error(exe+' failed: '+(r.error?.code||r.status));return r.stdout;};
let mounted=false;const results={evidence,image,mount,scope:'new synthetic 128 MiB APFS image only'};
function attach(readonly=false){command('/usr/bin/hdiutil',['attach','-owners','on','-nobrowse','-noautoopen','-mountpoint',mount,...(readonly?['-readonly']:[]),image]);mounted=true;}
function detach(){command('/usr/bin/hdiutil',['detach',mount]);mounted=false;}
(async()=>{try{
 command('/usr/bin/hdiutil',['create','-size','128m','-fs','APFS','-type','SPARSE','-volname','MarkdownSynthetic',image]);attach();
 // Warm the freshly built Foundation executable outside measured probe budgets.
 command(path.resolve('build/document-save'),['--inspect-volume',mount]);
 const r=spawnSync(process.execPath,['--test','test/native-cases/document-cross-volume.cjs'],{env:{...process.env,DOCUMENT_CROSS_VOLUME_ROOT:mount,DOCUMENT_SYNTHETIC_CAPACITY_VOLUME:mount},encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
 fs.writeFileSync(path.join(evidence,'tests.log'),(r.stdout||'')+(r.stderr||''));process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error||r.status!==0)throw Error('cross-volume cases failed');results.nativeCases=true;
 if(process.env.E2E_ELECTRON_EXECUTABLE){const ui=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config=e2e/playwright.config.cjs','e2e/document-cross-volume.spec.cjs','--workers=1','--output='+path.join(evidence,'electron')],{env:{...process.env,DOCUMENT_CROSS_VOLUME_ROOT:mount},encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});fs.writeFileSync(path.join(evidence,'electron.log'),(ui.stdout||'')+(ui.stderr||''));process.stdout.write(ui.stdout||'');if(ui.error||ui.status!==0)throw Error('cross-volume Electron workflow failed');results.electron=true;}

 const dir=path.join(mount,'reconnect');fs.mkdirSync(dir,{mode:0o700});const file=path.join(dir,'reconnect.md');fs.writeFileSync(file,'Before',{mode:0o600});const root=path.join(evidence,'records'),broker=createOriginalSave({root,binary:path.resolve('build/document-save')});
 const expected=createDocumentFileStore().read(file);expected.filePath=file;const saved=await broker.replace({expected,bytes:Buffer.from('After 中文'),revision:1,isAuthorized:()=>true});if(!saved.ok)throw Error(JSON.stringify(saved));broker.acknowledge(saved.recordId,saved);
 const stage=broker.locateStaging(saved.recordId);results.stage=stage;results.volumeBefore=require('../lib/document-save-locations').inspectLocalVolume(dir);
 detach();if(!broker.list().ok||fs.readFileSync(path.join(broker.locate(saved.recordId),'draft.md'),'utf8')!=='After 中文')throw Error('offline local recovery failed');let refused=false;try{broker.locateStaging(saved.recordId);}catch{refused=true;}if(!refused)throw Error('offline locator accepted');results.offlineLocalRecovery=true;
 attach();if(broker.locateStaging(saved.recordId)!==stage||fs.readFileSync(file,'utf8')!=='After 中文')throw Error('reconnected identity mismatch');results.volumeAfter=require('../lib/document-save-locations').inspectLocalVolume(dir);results.reconnect=true;detach();attach(true);const readonly=JSON.parse(command(path.resolve('build/document-save'),['--inspect-volume',mount]));if(readonly.ok||readonly.code!=='unsupported-filesystem')throw Error('read-only volume accepted');results.readonlyRefused=true;results.ok=true;
 }catch(e){results.ok=false;results.error=e.message;process.exitCode=1;}
 finally{try{if(mounted)detach();results.detached=true;}catch(e){results.detachError=e.message;process.exitCode=1;}fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
})();
