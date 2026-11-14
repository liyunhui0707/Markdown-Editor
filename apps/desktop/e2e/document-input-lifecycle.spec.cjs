const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
test('controlled input lifecycle: composed text, cancellation and history across common writing contexts',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-input-lifecycle-'))),original=path.join(root,'Input article.md');
 const source='# 标题中文\r\n\r\n普通中文段落。\r\n\r\n**粗体中文** and **bold *组合中文* tail**.\r\n\r\n- 列表中文\r\n\r\n| 名称 | 值 |\r\n| --- | --- |\r\n| 表格内容 | 原样 |\r\n';
 await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});
 const app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd:root,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
 const exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal}))),p=await app.firstWindow(),cdp=await p.context().newCDPSession(p),faults=[],network=[];
 p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 const evidence={root,cases:[],nativeIME:'NOT VERIFIED',inputDriver:'Chromium CDP composition, not physical candidate input',voiceOver:'NOT VERIFIED',passed:false};
 const snap=()=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const idle=()=>expect.poll(()=>p.locator('#status').textContent().then(JSON.parse).then(s=>!s.composing&&!s.pending&&!s.historyPending&&!s.locked)).toBe(true);
 const backup=()=>expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function caret(node){await node.click();await node.evaluate(n=>{const t=n.firstChild;if(t.nodeType!==Node.TEXT_NODE)throw Error('expected a synthetic text leaf');const r=document.createRange();r.setStart(t,2);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  await expect.poll(()=>node.evaluate(n=>{const v=n.closest('.tiptap').editor.view,s=getSelection();return v.state.selection.empty&&v.state.selection.from===v.posAtDOM(s.anchorNode,s.anchorOffset);})).toBe(true);}
 try{
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.hide();},original);
  await expect(p.locator('#empty-open')).toBeEnabled();await p.locator('#empty-open').click();await p.locator('#edit-copy').click();await backup();
  for(const [selector,text] of [['#editor h1','标题中文'],['#editor .tiptap > p:first-of-type','普通中文段落。'],['#editor strong','粗体中文'],['#editor strong em','组合中文'],['#editor li p','列表中文'],['#editor td p',' 表格内容 ']]){
   const node=p.locator(selector).filter({hasText:text}).first();await caret(node);const before=await snap();
   await cdp.send('Input.imeSetComposition',{text:'mo',selectionStart:2,selectionEnd:2});await expect(p.locator('#status')).toContainText('"composing":true');
   await cdp.send('Input.imeSetComposition',{text:'moxing',selectionStart:6,selectionEnd:6});expect((await snap()).source).toBe(source);expect((await snap()).revision).toBe(before.revision);
   for(const id of ['show-source','show-details','create-test-copy','save-original','close-current-document'])await expect(p.locator('#'+id)).toBeDisabled();
   const backupDuring=await snap();expect(backupDuring.draftBackup.revision).toBe(before.revision);await p.keyboard.press('F6');await expect(p.locator('#editor .tiptap')).toBeFocused();
   await cdp.send('Input.insertText',{text:'模型😀'});await idle();const expected=source.replace(text,text.slice(0,2)+'模型😀'+text.slice(2));
   expect((await snap()).source).toBe(expected);expect((await snap()).revision).toBe(before.revision+1);await backup();
   await p.locator('#format-undo').click();await expect.poll(async()=>(await snap())?.source).toBe(source);await p.locator('#format-redo').click();await expect.poll(async()=>(await snap())?.source).toBe(expected);await p.locator('#format-undo').click();await expect.poll(async()=>(await snap())?.source).toBe(source);await backup();
   await caret(node);const cancelled=await snap();await cdp.send('Input.imeSetComposition',{text:'cancel',selectionStart:6,selectionEnd:6});await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});await idle();
   const after=await snap();expect(after.source).toBe(source);expect(after.revision).toBe(cancelled.revision);expect(after.canRedo).toBe(cancelled.canRedo);evidence.cases.push({selector,text,commitOneRevision:true,exactUndoRedo:true,cancelNoOp:true});
  }
  await p.locator('#show-source').click();const cm=p.locator('#source-editor .cm-content');await cm.click();await p.keyboard.press('Meta+End');
  await cdp.send('Input.imeSetComposition',{text:'yuanma',selectionStart:6,selectionEnd:6});await expect(p.locator('#apply-source')).toBeDisabled();expect((await snap()).source).toBe(source);
  await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});await expect(p.locator('#apply-source')).toBeEnabled();await p.keyboard.press('Escape');await expect(p.locator('#source-dialog')).toBeHidden();expect((await snap()).source).toBe(source);
  expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);expect(faults).toEqual([]);expect(network).toEqual([]);evidence.sourceCancellation=true;evidence.passed=true;
 }finally{await app.close();evidence.exit=await exit;expect(evidence.exit).toEqual({code:0,signal:null});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({...evidence,faults,network},null,2));}
});
