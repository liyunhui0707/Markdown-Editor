const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
test('fresh first-key observations across mixed and near-capacity articles',async({},info)=>{
 test.setTimeout(180000);await fs.mkdir(info.outputDir,{recursive:true});
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-first-key-evidence-')));
 const prose='Common article 中文😀 **bold *both* tail** [link](../guide.md "keep") and `code`. '.repeat(6);
 const mixed='# Stable candidate\n\nOpening paragraph.\n\n'+Array.from({length:300},(_,i)=>'## Part '+i+'\n\n'+prose+'\n\n'+(i%20===0?'- [X] List **word'+i+'**\n  continued text [link](target "keep")\n- [ ] Next\n\n> Quote **quote'+i+'**  \n> continued text\n\n':'')).join('')+'| 名称 | 值 |\n| --- | --- |\n| 中文内容 | 保留 |\n';
 const paragraph='**bold *both* tail** '+('Synthetic paragraph 中文 🌿. ').repeat(24);
 const large='# Synthetic article\n\nOpening paragraph.\n\n'+Array.from({length:700},(_,i)=>`## Chapter ${i}\n\n${paragraph}\n\n`).join('')+'| Name | Value |\n| --- | --- |\n| 中文 | intact |\n\n> Preserved quote.\n\n```text\nprotected payload\n```\n';
 const plans=[{name:'mixed',source:mixed,targets:[['#editor .tiptap > p','Opening paragraph.',0],['#editor li strong','word0',0],['#editor blockquote strong','quote0',0]]},
  {name:'near-capacity',source:large,targets:[['#editor .tiptap > p',null,0],['#editor .tiptap > p',null,700]]}];
 const rows=[],exits=[],sessions=[];const src=path.resolve(__dirname,'..');
 for(const plan of plans){
  const source=plan.source,file=path.join(root,plan.name+'.md');await fs.writeFile(file,'\ufeff'+source,{flag:'wx',mode:0o600});
  for(const [selector,word,index]of plan.targets)for(const key of ['x',' ']){
   // Existing policy requires a canonical direct child of OS tmp, with this prefix.
   const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-first-key-')));sessions.push(cwd);
   const app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[src+'/main.js','--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(cwd,'drafts'),'--document-recents-test-root='+path.join(cwd,'recents')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
   const exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));
   try{
    const page=await app.firstWindow();await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();},file);
    await page.locator('#empty-open').click();await page.locator('#edit-copy').click();
    const node=(word?page.locator(selector).filter({hasText:word}):page.locator(selector)).nth(index);await node.click();await page.locator('#editor .tiptap').focus();
    const at=await node.evaluate(n=>{const r=document.createRange();r.selectNodeContents(n);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return n.closest('.tiptap').editor.view.posAtDOM(s.anchorNode,s.anchorOffset);});
    await expect.poll(()=>node.evaluate(n=>n.closest('.tiptap').editor.state.selection.from)).toBe(at);
    const api=await import(pathToFileURL(src+'/lib/document-source-map.mjs').href),mapped=api.mapTextEdit(source,{from:at,to:at,insert:key});expect(mapped.ok).toBe(true);
    await page.evaluate(()=>{const status=document.querySelector('#status'),baseRevision=JSON.parse(status.textContent).revision,p={baseRevision,inputAt:null,ackAt:null,frameAt:null};window.__firstKeyObservation=p;
     document.querySelector('#editor').addEventListener('beforeinput',()=>{p.inputAt=performance.now();requestAnimationFrame(()=>{p.frameAt=performance.now();});},{once:true,capture:true});
     const observer=new MutationObserver(()=>{const s=JSON.parse(status.textContent);if(p.inputAt!==null&&s.revision===baseRevision+1&&!s.pending&&!s.locked&&!s.historyPending&&!s.composing){p.ackAt=performance.now();observer.disconnect();}});observer.observe(status,{childList:true,subtree:true,characterData:true});});
    await page.keyboard.type(key);await expect.poll(()=>page.evaluate(()=>!!window.__firstKeyObservation?.ackAt&&!!window.__firstKeyObservation?.frameAt)).toBe(true);
    const snap=await page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);expect(snap.source).toBe(mapped.source);
    const observed=await page.evaluate(()=>{const p=window.__firstKeyObservation;return {ackObservationMs:p.ackAt-p.inputAt,nextFrameCallbackMs:p.frameAt-p.inputAt,visibility:document.visibilityState};});
    const native=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {visible:w.isVisible(),minimized:w.isMinimized()};});expect(native).toEqual({visible:true,minimized:false});expect(observed.visibility).toBe('visible');
    rows.push({article:plan.name,units:source.length,selector,index,word,key,...observed,native});await fs.writeFile(info.outputPath('observations.json'),JSON.stringify({rows,root,scope:'Fresh native-visible edit-copy session for each key; no profiler; beforeinput-to-observed-ACK and next-frame callback, not physical IME/paint'},null,2));
    await expect.poll(async()=>{const s=await page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
   }finally{await app.close();const e=await exit;exits.push(e);expect(e).toEqual({code:0,signal:null});}
   expect(await fs.readFile(file,'utf8')).toBe('\ufeff'+source);
  }
 }
 await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed:true,rows,root,sessions,exits,sourceUnchanged:true,nativeIME:'NOT VERIFIED'},null,2));
});
