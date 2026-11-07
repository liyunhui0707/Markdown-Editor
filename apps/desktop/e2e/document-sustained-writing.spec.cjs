const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');

test('sustained writing: repeated long-document sessions preserve edits, close and release renderer state',async({},info)=>{
 test.setTimeout(240000);
 if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-sustained-'))),original=path.join(root,'Synthetic long article.md');
 const source='# Synthetic article\n\nOpening paragraph.\n\n'+Array.from({length:700},(_,i)=>`## Chapter ${i}\n\n${'Synthetic paragraph 中文 🌿. '.repeat(25)}\n\n`).join('');
 const bytes=Buffer.from('\ufeff'+source),hash=b=>crypto.createHash('sha256').update(b).digest('hex');await fs.writeFile(original,bytes,{flag:'wx',mode:0o600});
 const app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy',
  '--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],
  cwd:root,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
 const exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal}))),p=await app.firstWindow(),faults=[],network=[];
 p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 const evidence={root,textUnits:source.length,cycles:[],nativeIME:'NOT VERIFIED',nativeDialogs:'controlled',passed:false};
 const snap=()=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const idle=()=>expect.poll(()=>p.locator('#status').textContent().then(JSON.parse).then(s=>s.pending===0&&!s.locked&&!s.historyPending)).toBe(true);
 const cdp=await p.context().newCDPSession(p);
 async function sample(){
  // Only the test forces a collection, to separate retained renderer heap from
  // GC scheduling. Process working sets are recorded separately, never a leak proof.
  await cdp.send('HeapProfiler.collectGarbage');
  return {renderer:await cdp.send('Runtime.getHeapUsage'),dom:await cdp.send('Memory.getDOMCounters'),
   main:await app.evaluate(()=>process.getHeapStatistics()),processes:await app.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,memory:m.memory})))};
 }
 try{
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;
   const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.hide();},original);
  await expect(p.locator('#empty-open')).toBeEnabled();evidence.empty=await sample();
  for(let cycle=0;cycle<3;cycle++){
   await p.locator('#empty-open').click();await p.locator('#edit-copy').click();
   const para=p.locator('#editor .tiptap > p').first();await para.click();await p.keyboard.press('End');await idle();
   const text=(' abcdefghijklmnop').repeat(4),start=Date.now();await p.keyboard.type(text,{delay:20});await idle();
   const typed=source.replace('Opening paragraph.','Opening paragraph.'+text);expect((await snap()).source).toBe(typed);
   const typingMs=Date.now()-start;
   await p.locator('#format-undo').click();await expect.poll(async()=>(await snap()).source===typed.slice(0,typed.indexOf(text)+text.length-1)+typed.slice(typed.indexOf(text)+text.length)).toBe(true);
   await p.locator('#format-redo').click();await expect.poll(async()=>(await snap()).source===typed).toBe(true);
   await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toBeVisible();await p.keyboard.press('Escape');
   await expect.poll(async()=>{const s=await snap();return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
   const current=await snap(),drafts=await p.evaluate(async()=>window.documentDemo.listDrafts());
   expect(drafts.drafts).toHaveLength(cycle+1);expect(drafts.drafts.some(d=>d.label===current.label)).toBe(true);
   const open=await sample();await p.locator('#close-current-document').click();await expect(p.locator('#edit-copy')).toBeVisible();
   expect((await snap()).source).toBe(source);await p.locator('#close-current-document').click();await expect(p.locator('#empty-open')).toBeVisible();
   await expect(p.locator('#documents option')).toHaveCount(0);await expect(p.locator('#editor .tiptap')).toHaveCount(0);
   evidence.cycles.push({cycle,typingMs,open,closed:await sample()});expect(hash(await fs.readFile(original))).toBe(hash(bytes));
  }
  expect(faults).toEqual([]);expect(network).toEqual([]);evidence.passed=true;
 }finally{
  await app.close();evidence.exit=await exit;expect(evidence.exit).toEqual({code:0,signal:null});
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({...evidence,faults,network,artifacts:'only synthetic files in the named OS temporary directory; retained'},null,2));
 }
});
