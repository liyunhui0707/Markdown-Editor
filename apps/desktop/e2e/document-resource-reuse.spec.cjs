const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('fixed draft reuse: repeated restore and close retain one record and release editing surfaces',async({},info)=>{
 test.setTimeout(180000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-resource-reuse-'))),original=path.join(root,'Repeated draft.md');
 const source='# Reuse\n\n'+Array.from({length:500},(_,i)=>`## Chapter ${i}\n\n${'Paragraph 中文 **bold *both* text**. '.repeat(16)}\n\n`).join('');await fs.writeFile(original,source,{flag:'wx',mode:0o600});
 const app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd:root,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
 const exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal}))),p=await app.firstWindow(),cdp=await p.context().newCDPSession(p),faults=[],samples=[];p.on('pageerror',e=>faults.push(e.message));
 const snap=()=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 let passed=false;
 try{
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.hide();},original);
  await expect(p.locator('#empty-open')).toBeEnabled();await p.locator('#empty-open').click();await p.locator('#edit-copy').click();await expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
  await p.locator('#close-current-document').click();await expect(p.locator('#edit-copy')).toBeVisible();await p.locator('#close-current-document').click();await expect(p.locator('#empty-new')).toBeVisible();
  const drafts=await p.evaluate(async()=>window.documentDemo.listDrafts());expect(drafts.drafts).toHaveLength(1);const id=drafts.drafts[0].id;
  for(let cycle=0;cycle<8;cycle++){
   await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await expect.poll(async()=>(await snap())?.source).toBe(source);
   const current=await snap();expect(current.originalSave).toBeNull();expect(current.linkedFile).toBeNull();
   await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toBeVisible();await p.keyboard.press('Escape');
   await expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
   await p.locator('#close-current-document').click();await expect(p.locator('#empty-new')).toBeVisible();await expect(p.locator('#editor .tiptap')).toHaveCount(0);await expect(p.locator('#source-editor .cm-editor')).toHaveCount(0);await expect(p.locator('#documents option')).toHaveCount(0);
   expect((await p.evaluate(async()=>window.documentDemo.listDrafts())).drafts.map(d=>d.id)).toEqual([id]);
   expect((await p.evaluate(async sessionId=>window.documentDemo.snapshot({sessionId}),current.sessionId)).ok).toBe(false);
   const beforeCollection=await cdp.send('Runtime.getHeapUsage');await cdp.send('HeapProfiler.collectGarbage');
   samples.push({cycle,beforeCollection,heap:await cdp.send('Runtime.getHeapUsage'),dom:await cdp.send('Memory.getDOMCounters'),processes:await app.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,memory:m.memory})))});
  }
  expect(await fs.readFile(original,'utf8')).toBe(source);expect(faults).toEqual([]);passed=true;
 }finally{await app.close();const result=await exit;expect(result).toEqual({code:0,signal:null});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,textUnits:source.length,fixedDraftCount:1,samples,faults,exit:result,scope:'controlled resource observations, not long-term leak proof'},null,2));}
});
