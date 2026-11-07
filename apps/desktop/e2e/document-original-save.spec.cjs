const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('original save: consent, repeat, undo, conflict, restart recovery and save-as binding',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-original-workflow-')));
 await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),folder=path.join(fixture.dir,'Documents','Desktop');await fs.mkdir(folder,{recursive:true,mode:0o700});
 const original=path.join(folder,'Original.md'),target=path.join(folder,'New copy.md'),bytes=Buffer.from('\ufeff# Original\r\n\r\nFirst synthetic paragraph.\r\n\r\n');await fs.writeFile(original,bytes,{mode:0o600,flag:'wx'});
 const versions=path.join(root,'versions'),env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
 let app,exit,result;const faults=[],requests=[],exits=[];
 const snap=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const backup=async p=>expect.poll(async()=>{const s=await snap(p);return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+versions],cwd,env,chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow,shell},{original,target})=>{
   global.saveConsent=0;global.saveRequests=0;global.revealed=[];
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:target});
   dialog.showMessageBox=async(_win,options)=>{if(options.message==='保存回原文件？'){global.saveRequests++;return {response:global.saveConsent};}return {response:1};};dialog.showMessageBoxSync=()=>1;shell.showItemInFolder=file=>global.revealed.push(file);
   const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();
  },{original,target});await expect(p.locator('#empty-new')).toBeEnabled();return p;
 }
 async function stop(){if(app){await app.close();app=null;const r=await exit;exits.push(r);expect(r).toEqual({code:0,signal:null});}}
 async function edit(p,text){await p.locator('#show-source').click();const content=p.locator('#source-editor .cm-content');await content.click();await p.keyboard.press('Meta+End');await p.keyboard.insertText(text);await p.locator('#apply-source').click();await expect(p.locator('#source-dialog')).toBeHidden();await backup(p);}
 try{
  let p=await launch();await p.locator('#empty-open').click();await expect(p.locator('#save-original')).toBeHidden();await p.locator('#edit-copy').click();await expect(p.locator('#save-original')).toBeVisible();
  await edit(p,'More');const before=await snap(p);await p.locator('#save-original').click();await expect(p.locator('#original-save-status')).toContainText('取消');expect(await fs.readFile(original)).toEqual(bytes);expect((await snap(p))?.dirty).toBe(true);
  await app.evaluate(()=>{global.saveConsent=1;});await p.locator('#save-original').click();await expect.poll(async()=>(await snap(p))?.originalSave?.receipt?.state).toBe('saved-confirmed');
  const saved=await snap(p);expect(saved.dirty).toBe(false);expect(saved.source).toBe(before.source);expect(saved.canUndo).toBe(true);expect(await fs.readFile(original)).toEqual(Buffer.from('\ufeff'+saved.source));
  const record=saved.originalSave.receipt;expect(await fs.readFile(path.join(versions,record.recordId,'baseline.md'))).toEqual(bytes);expect(await fs.readFile(path.join(versions,record.recordId,'draft.md'))).toEqual(Buffer.from('\ufeff'+saved.source));
  await p.locator('#format-undo').click();await expect.poll(async()=>(await snap(p))?.dirty).toBe(true);await p.locator('#format-redo').click();await expect.poll(async()=>(await snap(p))?.dirty).toBe(false);
  await edit(p,' Second');await p.keyboard.press('Meta+s');await expect.poll(async()=>(await snap(p))?.dirty).toBe(false);expect(await app.evaluate(()=>global.saveRequests)).toBe(2); // canceled + accepted once; no repeated consent.
  const second=await snap(p);expect(second.originalSave.lastConfirmed.revision).toBe(second.revision);
  await p.locator('#show-details').click();await expect(p.locator('#original-save-receipt')).toContainText(second.originalSave.lastConfirmed.sha256);await p.locator('#close-document-details-dialog').click();await p.screenshot({path:info.outputPath('original-save-success.png')});
  await edit(p,' Third');await fs.writeFile(original,'Outside writer content');await p.locator('#save-original').click();await expect.poll(async()=>(await snap(p))?.originalSave?.stopped).toBe(true);const conflicted=await snap(p);
  expect(conflicted.dirty).toBe(true);expect(conflicted.originalSave.lastConfirmed).toEqual(second.originalSave.lastConfirmed);expect(await fs.readFile(original,'utf8')).toBe('Outside writer content');await expect(p.locator('#original-save-status')).toContainText('未保存');await expect(p.locator('#save-original')).toBeDisabled();
  await p.screenshot({path:info.outputPath('original-save-conflict.png')});
  await p.locator('#show-drafts').click();await expect(p.locator('.save-version-row')).toHaveCount(2);await p.locator('.save-version-row').first().getByRole('button').click();await expect.poll(async()=>(await app.evaluate(()=>global.revealed))[0]).toContain(versions);await p.locator('#close-draft-dialog').click();
  const draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,conflicted.label);await stop();p=await launch();await p.locator('#show-drafts').click();await expect(p.locator('.save-version-row')).toHaveCount(2);await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
  const restored=await snap(p);expect(restored.source).toBe(conflicted.source);expect(restored.originalSave).toBeNull();await expect(p.locator('#save-original')).toBeHidden();await backup(p);
  await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snap(p))?.confirmedCopy?.filePath).toBe(target);await expect(p.locator('#save-original')).toBeVisible();
  await edit(p,' New target');await app.evaluate(()=>{global.saveConsent=1;});await p.locator('#save-original').click();await expect.poll(async()=>(await snap(p))?.dirty).toBe(false);expect((await snap(p))?.originalSave.lastConfirmed.filePath).toBe(target);expect(await fs.readFile(original,'utf8')).toBe('Outside writer content');
  expect(faults).toEqual([]);expect(requests).toEqual([]);await stop();result={ok:true,root,versions,consent:true,repeat:true,undo:true,conflictPreserved:true,restart:true,saveAsBinding:true,nativeDialogs:'controlled',nativeIME:'NOT VERIFIED'};
 }catch(e){if(app){const p=await app.firstWindow();console.log('original-save failure',await p.locator('#status').textContent(),await snap(p),faults);await p.screenshot({path:info.outputPath('failure.png')}).catch(()=>{});}throw e;}
 finally{await stop();const archive=fixture.archive({quiescent:!app});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({...result,ok:!!result,root,versions,archive,exits,faults,requests},null,2));}
});
