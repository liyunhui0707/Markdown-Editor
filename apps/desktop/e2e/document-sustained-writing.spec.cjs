const {focusNativeWindow,settleNativeCaret}=require('./helpers/document-native-selection.cjs');
const {test,expect,_electron}=require('@playwright/test');
const {createResourceProbe}=require('./helpers/document-resource-probe.cjs');
const {stopOwnedElectron}=require('./helpers/document-owned-stop.cjs');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');

test('sustained writing: repeated long-document sessions preserve edits, close and release renderer state',async({},info)=>{
 const minutes=Number(process.env.DOCUMENT_WRITING_SOAK_MINUTES||0);
 if(!Number.isInteger(minutes)||minutes<0||minutes>30)throw Error('DOCUMENT_WRITING_SOAK_MINUTES must be an integer from 0 to 30');
 const inputMode=process.env.DOCUMENT_WRITING_INPUT_MODE||'confirmed';
 if(!['confirmed','unpaced'].includes(inputMode))throw Error('DOCUMENT_WRITING_INPUT_MODE must be confirmed or unpaced');
 const unpaced=inputMode==='unpaced';
 const soakMs=minutes*60000,keyDelay=minutes?80:20;test.setTimeout(soakMs+240000);
 if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-sustained-'))),original=path.join(root,'Synthetic long article.md');
 const paragraph='**bold *both* tail** '+('Synthetic paragraph 中文 🌿. ').repeat(24);
 const source='# Synthetic article\n\nOpening paragraph.\n\n'+Array.from({length:700},(_,i)=>`## Chapter ${i}\n\n${paragraph}\n\n`).join('')
  +'| Name | Value |\n| --- | --- |\n| 中文 | intact |\n\n> Preserved quote.\n\n```text\nprotected payload\n```\n';
 const bytes=Buffer.from('\ufeff'+source),hash=b=>crypto.createHash('sha256').update(b).digest('hex');await fs.writeFile(original,bytes,{flag:'wx',mode:0o600});
 const evidence={root,textUnits:source.length,requestedSoakMinutes:minutes,keyDelayMs:keyDelay,inputPacing:unpaced?'unpaced bursts':'confirmed bursts',maxBurstUnits:unpaced?68:8,startedAt:Date.now(),cycles:[],samples:[],exits:[],sessionRoots:[],nativeIME:'NOT VERIFIED',nativeDialogs:'controlled',passed:false};
 let app,p,cdp,exit,probe,lastSample=0;const faults=[],network=[],retained=[];
 const snap=()=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const idle=async()=>{try{await expect.poll(()=>p.locator('#status').textContent().then(JSON.parse).then(s=>s.pending===0&&!s.locked&&!s.historyPending)).toBe(true);}catch(error){
  const diagnostic=await p.evaluate(()=>{const v=document.querySelector('#editor .tiptap')?.editor?.view,s=getSelection();return {status:JSON.parse(document.querySelector('#status').textContent),warning:document.querySelector('#viewer-status').textContent,selection:v?.state.selection.toJSON(),focus:v?.hasFocus(),active:document.activeElement?.tagName,domCollapsed:s?.isCollapsed,pressureVisible:!document.querySelector('#input-pressure-panel').hidden,pressureStatus:document.querySelector('#input-pressure-status').textContent};});
  console.error('soak-idle-failure:'+JSON.stringify(diagnostic));await fs.writeFile(info.outputPath('idle-failure.json'),JSON.stringify(diagnostic,null,2));throw error;
 }};
 // This checks repeated writing/history/recovery, not an unacknowledged input
 // rate. CI may confirm a near-capacity document slower than the fixed driver.
 // Keep each native-key burst bounded; any pause still fails idle(), never resumes
 // automatically. Deliberate queue saturation has its own recovery workflow.
 async function typeConfirmed(text){
  if(unpaced){await p.keyboard.type(text,{delay:keyDelay});await idle();return;}
  for(let i=0;i<text.length;i+=8){await p.keyboard.type(text.slice(i,i+8),{delay:keyDelay});await idle();}
 }
 const natural=()=>probe.sample(),sample=()=>probe.sample({collect:true});
 async function progress(label){
  if(evidence.samples.length>=40)throw Error('bounded sample capacity exceeded');
  const sample={label,elapsedMs:Date.now()-evidence.startedAt,...await natural()};evidence.samples.push(sample);lastSample=Date.now();
  await fs.writeFile(info.outputPath('progress.json'),JSON.stringify(evidence,null,2));
  console.log('soak-progress:'+JSON.stringify({label,elapsedMs:sample.elapsedMs,cycles:evidence.cycles.length,heapBytes:sample.renderer.usedSize}));
 }
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-soak-session-')));evidence.sessionRoots.push(cwd);
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy',
   '--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],
   cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));p=await app.firstWindow();cdp=await p.context().newCDPSession(p);probe=createResourceProbe({app,page:p,cdp});
  p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;
   const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();},original);
  await expect(p.locator('#empty-open')).toBeEnabled();await focusNativeWindow(app,p);
  await p.evaluate(()=>{window.__soakQueuePeak=0;const n=document.querySelector('#status');new MutationObserver(()=>{window.__soakQueuePeak=Math.max(window.__soakQueuePeak,JSON.parse(n.textContent).pending||0);}).observe(n,{childList:true,subtree:true,characterData:true});});
 }
 async function stop(){if(app){const result=await stopOwnedElectron({app,exit});app=null;evidence.exits.push(result);
  if(evidence.passed||evidence.cycles.length===6)expect(result).toEqual({code:0,signal:null,forced:false});}}
 try{
  await launch();evidence.empty=await sample();await progress('empty');
  for(let cycle=0;cycle<6;cycle++){
   await p.locator('#empty-open').click();await p.locator('#edit-copy').click();await p.evaluate(()=>{window.__soakQueuePeak=0;});
   const paragraphIndex=[0,350,700][cycle%3],para=p.locator('#editor .tiptap > p').nth(paragraphIndex);
   await para.click();await settleNativeCaret(para);await para.evaluate(n=>{const range=document.createRange();range.selectNodeContents(n);range.collapse(false);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
   await expect.poll(()=>para.evaluate(n=>{const s=n.closest('.tiptap').editor.state.selection;return s.empty&&s.$from.parentOffset===s.$from.parent.content.size;})).toBe(true);await idle();
   const marker=paragraphIndex===0?'Opening paragraph.':`## Chapter ${paragraphIndex-1}\n\n${paragraph}`;
   const sourceEnd=source.indexOf(marker)+marker.length;expect(sourceEnd).toBeGreaterThan(marker.length);
   const text=(' abcdefghijklmnop').repeat(4),start=Date.now(),rounds=[];let added='',typed=source;
   do{
    if(source.length+added.length+text.length>524288)throw Error('Soak fixture would exceed document capacity');
    const roundStart=Date.now();await typeConfirmed(text);added+=text;
    typed=source.slice(0,sourceEnd)+added+source.slice(sourceEnd);expect((await snap()).source).toBe(typed);
    const typingMs=Date.now()-roundStart;
    await p.locator('#format-undo').click();await expect.poll(async()=>(await snap())?.source===typed.slice(0,sourceEnd+added.length-1)+typed.slice(sourceEnd+added.length)).toBe(true);
    await p.locator('#format-redo').click();await expect.poll(async()=>(await snap())?.source===typed).toBe(true);rounds.push({typingMs,units:added.length});
    if(minutes&&Date.now()-lastSample>=60000)await progress('writing-'+cycle);
   }while(Date.now()-start<soakMs/6);
   const typingMs=Date.now()-start;await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toBeVisible();await p.keyboard.press('Escape');
   await expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
   const current=await snap(),drafts=await p.evaluate(async()=>window.documentDemo.listDrafts());expect(drafts.drafts).toHaveLength(cycle+1);
   const recovery=drafts.drafts.find(d=>d.label===current.label);expect(recovery).toBeTruthy();retained.push({id:recovery.id,source:typed});
   const open=await sample();await p.locator('#close-current-document').click();await expect(p.locator('#edit-copy')).toBeVisible();expect((await snap()).source).toBe(source);
   await p.locator('#close-current-document').click();await expect(p.locator('#empty-open')).toBeVisible();await expect(p.locator('#documents option')).toHaveCount(0);await expect(p.locator('#editor .tiptap')).toHaveCount(0);
   for(const id of ['source','recovery','test-copy-result','test-copy-summary','test-copy-operation','original-save-receipt','draft-backup-status','copy-action-status','input-pressure-source','save-version-list','linked-file-path','linked-file-status','linked-file-checked'])await expect(p.locator('#'+id)).toHaveText('');
   expect((await p.evaluate(async sessionId=>window.documentDemo.snapshot({sessionId}),current.sessionId)).ok).toBe(false);
   expect((await p.evaluate(async()=>window.documentDemo.listDrafts())).drafts).toHaveLength(cycle+1);
   evidence.cycles.push({cycle,paragraphIndex,typingMs,rounds,pendingPeak:await p.evaluate(()=>window.__soakQueuePeak),sourceSha256:hash(Buffer.from(typed)),open,closed:await sample()});expect(hash(await fs.readFile(original))).toBe(hash(bytes));await progress('closed-'+cycle);
  }
  await stop();await launch();await p.locator('#show-drafts').click();const last=retained.at(-1);
  await p.locator(`[data-draft-id="${last.id}"]`).getByRole('button',{name:'恢复副本'}).click();await expect.poll(async()=>(await snap())?.source===last.source).toBe(true);
  const restored=await snap();expect(restored.originalSave).toBeNull();expect(restored.linkedFile).toBeNull();expect(restored.canUndo).toBe(false);
  const para=p.locator('#editor .tiptap > p').first();await para.click();await settleNativeCaret(para);await para.evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  await expect.poll(()=>para.evaluate(n=>n.closest('.tiptap').editor.state.selection.$from.parentOffset===n.textContent.length)).toBe(true);
  await typeConfirmed(' continued');const resumed=last.source.replace('Opening paragraph.','Opening paragraph. continued');expect((await snap()).source).toBe(resumed);
  await p.locator('#format-undo').click();await expect.poll(async()=>(await snap())?.source===resumed.replace('continued','continue')).toBe(true);await p.locator('#format-redo').click();await expect.poll(async()=>(await snap())?.source===resumed).toBe(true);
  evidence.restart={exact:true,continued:true,restoredHash:hash(Buffer.from(last.source)),sample:await sample()};expect(hash(await fs.readFile(original))).toBe(hash(bytes));expect(faults).toEqual([]);expect(network).toEqual([]);evidence.passed=true;
  console.log('soak-input-envelope:'+JSON.stringify({inputPacing:evidence.inputPacing,keyDelayMs:keyDelay,maxBurstUnits:evidence.maxBurstUnits,cycles:evidence.cycles.map(c=>({cycle:c.cycle,typingMs:c.typingMs,pendingPeak:c.pendingPeak,sourceSha256:c.sourceSha256})),restart:evidence.restart.exact}));
 }finally{try{await stop();}finally{await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({...evidence,elapsedMs:Date.now()-evidence.startedAt,faults,network,artifacts:'only synthetic files in the named OS temporary directories; retained'},null,2));}}
});
