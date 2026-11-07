const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');

// Input automation measures controlled text, not a native IME candidate session.
for(const [chapters,nl] of [[160,'\n'],[700,'\r\n']]) test(`daily writing: ${chapters} chapters, paced input, history and restart recovery`,async({},info)=>{
 test.setTimeout(120000);
 if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-daily-'))),file=path.join(root,'Synthetic article.md');
 const source=['# Synthetic article','','Opening paragraph.','',...Array.from({length:chapters},(_,i)=>[`## Chapter ${i}`,'','Synthetic paragraph 中文 🌿. '.repeat(25),'']).flat(),'<div>protected</div>',''].join(nl);
 await fs.writeFile(file,'\ufeff'+source,{flag:'wx',mode:0o600});
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),originalHash=hash(await fs.readFile(file));
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()};
 const faults=[],requests=[],exits=[];let app,exit;
 const evidence={root,textUnits:source.length,newline:JSON.stringify(nl),nativeIME:'NOT VERIFIED',nativeDialogs:'controlled',passed:false};
 const snap=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const idle=async p=>expect.poll(()=>p.locator('#status').textContent().then(JSON.parse).then(s=>s.pending===0&&!s.historyPending&&!s.locked)).toBe(true);
 const backup=async p=>expect.poll(async()=>{const s=await snap(p);return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function stop(){if(app){await app.close();app=null;const status=await exit;exits.push(status);expect(status).toEqual({code:0,signal:null});}}
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-daily-window-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy',
   '--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),
   '--document-original-saves-test-root='+path.join(root,'versions')],cwd,env,chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));
  const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;
   const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.hide();},file);
  await expect(p.locator('#empty-new')).toBeEnabled();return p;
 }
 try{
  let p=await launch();await p.locator('#empty-open').click();expect((await snap(p)).source).toBe(source);await p.locator('#edit-copy').click();
  const paragraph=p.locator('#editor .tiptap > p').first();await paragraph.click();await p.keyboard.press('End');await idle(p);
  await p.evaluate(()=>{window.keptOutline=document.querySelector('#outline-list button');window.peakPending=0;window.longTasks=[];
   new MutationObserver(()=>{window.peakPending=Math.max(peakPending,JSON.parse(document.querySelector('#status').textContent).pending||0);}).observe(document.querySelector('#status'),{childList:true});
   new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});});
  const text=' daily writing 1234567890',start=Date.now();await p.keyboard.type(text,{delay:20});await idle(p);
  evidence.typingAndDrainMs=Date.now()-start;const typed=source.replace('Opening paragraph.','Opening paragraph.'+text);
  expect((await snap(p)).source).toBe(typed);expect(await p.evaluate(()=>keptOutline===document.querySelector('#outline-list button'))).toBe(true);
  await p.keyboard.insertText(' 中文😀[]');await idle(p);const unicode=typed.replace('Opening paragraph.'+text,'Opening paragraph.'+text+' 中文😀[]');
  expect((await snap(p)).source).toBe(unicode);
  await p.locator('#format-undo').click();await expect.poll(async()=>(await snap(p)).source).toBe(typed);
  await p.locator('#format-redo').click();await expect.poll(async()=>(await snap(p)).source).toBe(unicode);
  await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toBeVisible();await expect(p.locator('#source-metadata')).toContainText('UTF-8 BOM');await p.keyboard.press('Escape');expect((await snap(p)).source).toBe(unicode);
  if(await p.locator('#document-outline').isHidden())await p.locator('#toggle-document-outline').click();
  await p.locator('#outline-filter').fill('Chapter '+(chapters-1));await expect(p.locator('#outline-count')).toHaveText(`1 / ${chapters+1}`);
  await p.locator('#outline-filter').press('Enter');expect(await p.locator('#document-scroll').evaluate(n=>n.scrollTop)).toBeGreaterThan(10000);
  await backup(p);const saved=await snap(p),draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,saved.label);
  evidence.input=await p.evaluate(()=>({peakPending,longTasks}));evidence.memory=await app.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,memory:m.memory})));
  await stop();p=await launch();await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
  await expect.poll(async()=>(await snap(p))?.source===unicode).toBe(true);
  const recovered=await snap(p);expect(recovered.source).toBe(unicode);expect(recovered.bom).toBe(true);expect(recovered.canUndo).toBe(false);expect(recovered.confirmedCopy??null).toBeNull();
  const recoveredParagraph=p.locator('#editor .tiptap > p').first();await recoveredParagraph.click();
  // End targets a visual line on macOS; choose the paragraph boundary explicitly.
  await recoveredParagraph.evaluate(n=>{const range=document.createRange();range.selectNodeContents(n);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
  await p.keyboard.type(' resumed',{delay:20});await idle(p);
  expect((await snap(p)).source).toBe(unicode.replace('Opening paragraph.'+text+' 中文😀[]','Opening paragraph.'+text+' 中文😀[] resumed'));await backup(p);
  expect(hash(await fs.readFile(file))).toBe(originalHash);expect(faults).toEqual([]);expect(requests).toEqual([]);await stop();
  Object.assign(evidence,{passed:true,exactSource:true,history:true,outlineDOMRetained:true,restartRecovery:true,originalUnchanged:true});
 }finally{
  await stop();await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({...evidence,faults,requests,exits,artifacts:'synthetic source/drafts retained only in the named OS temporary directory; no Home fixture'},null,2));
 }
});
