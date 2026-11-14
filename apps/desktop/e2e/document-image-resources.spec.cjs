const {test,expect,_electron}=require('@playwright/test');
const {createResourceProbe}=require('./helpers/document-resource-probe.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {syntheticPNG}=require('../test/helpers/synthetic-raster.cjs');
test('image resource lifecycle: repeated references share transfers and closed surfaces stay released',async({},info)=>{
 test.setTimeout(180000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-image-resources-')));
 const png=syntheticPNG(17,true),href='markdown-image-'+createHash('sha256').update(png).digest('hex')+'.png';
 const source='# Repeated image article\n\nOpening paragraph.\n\n'+Array.from({length:40},(_,i)=>`![Picture ${i}](<${href}>)\n\n${'Article 中文 **bold**. '.repeat(100)}\n\n`).join('');
 const original=path.join(root,'Repeated pictures.md');await fs.writeFile(original,source,{flag:'wx',mode:0o600});await fs.writeFile(path.join(root,href),png,{flag:'wx',mode:0o600});
 const app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd:root,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
 const exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal}))),p=await app.firstWindow(),cdp=await p.context().newCDPSession(p),faults=[],network=[],samples=[];
 p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 const probe=createResourceProbe({app,page:p,cdp});
 const snap=()=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const backup=()=>expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 const transfers=()=>app.evaluate(()=>globalThis.syntheticPreviewTransfers);
 async function sample(label,collect=false){samples.push({label,...await probe.sample({collect}),transfers:await transfers()});}
 let passed=false,firstTransfers;
 try{
  await app.evaluate(({ipcMain,dialog,BrowserWindow},original)=>{
   // Test-only observer of the existing handler; no application API or bypass.
   const handler=ipcMain._invokeHandlers.get('document-demo:request');if(typeof handler!=='function')throw Error('test IPC observer unavailable');
   globalThis.syntheticPreviewTransfers={requests:0,bytes:0};ipcMain.removeHandler('document-demo:request');
   ipcMain.handle('document-demo:request',async(event,data)=>{const r=await handler(event,data);if(data?.operation==='image-preview'){globalThis.syntheticPreviewTransfers.requests++;if(r?.ok)globalThis.syntheticPreviewTransfers.bytes+=Buffer.byteLength(r.dataUrl);}return r;});
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();
  },original);
  await expect(p.locator('#empty-open')).toBeEnabled();await sample('empty');await p.locator('#empty-open').click();
  await expect(p.locator('#editor img.document-local-image:not([hidden])')).toHaveCount(40);
  firstTransfers=await transfers();await sample('readonly-loaded');expect(firstTransfers.requests).toBe(1);
  await p.locator('#edit-copy').click();await expect(p.locator('#editor img.document-local-image:not([hidden])')).toHaveCount(40);await backup();
  const drafts=await p.evaluate(()=>window.documentDemo.listDrafts());expect(drafts.drafts).toHaveLength(1);const id=drafts.drafts[0].id;
  await p.locator('#close-current-document').click();await p.locator('#close-current-document').click();await expect(p.locator('#empty-new')).toBeVisible();
  for(let cycle=0;cycle<8;cycle++){
   await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();
   await expect(p.locator('#editor img.document-local-image:not([hidden])')).toHaveCount(40);expect((await snap()).source).toBe(source);
   const para=p.locator('#editor .tiptap > p').first();await para.click();await para.evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);});
   await p.keyboard.press('End');await p.keyboard.insertText(' added');await expect.poll(async()=>(await snap())?.source).toBe(source.replace('Opening paragraph.','Opening paragraph. added'));
   await p.locator('#format-undo').click();await expect.poll(async()=>(await snap())?.source).toBe(source);await backup();
   await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toBeVisible();await p.keyboard.press('Escape');await sample('open-'+cycle);
   const current=await snap();await p.locator('#close-current-document').click();await expect(p.locator('#empty-new')).toBeVisible();
   await expect(p.locator('#editor .tiptap')).toHaveCount(0);await expect(p.locator('#editor img.document-local-image')).toHaveCount(0);await expect(p.locator('#source-editor .cm-editor')).toHaveCount(0);
   expect((await p.evaluate(()=>window.documentDemo.listDrafts())).drafts.map(d=>d.id)).toEqual([id]);expect((await p.evaluate(id=>window.documentDemo.snapshot({sessionId:id}),current.sessionId)).ok).toBe(false);await sample('closed-'+cycle);
  }
  // Separate a diagnostic test-only collection from natural samples; never force GC in product.
  await sample('closed-diagnostic-collection',true);
  expect(samples.at(-1).dom.nodes).toBeLessThan(samples[0].dom.nodes+1000);
  expect(await fs.readFile(original,'utf8')).toBe(source);expect(await fs.readFile(path.join(root,href))).toEqual(png);expect(faults).toEqual([]);expect(network).toEqual([]);passed=true;
 }finally{
  await app.close();const result=await exit;expect(result).toEqual({code:0,signal:null});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,imageBytes:png.length,occurrences:40,textUnits:source.length,firstTransfers,samples,faults,network,exit:result,scope:'synthetic fixed-draft image workload; RSS observations do not prove leak elimination; no physical IME/clipboard/VoiceOver'},null,2));
 }
});
