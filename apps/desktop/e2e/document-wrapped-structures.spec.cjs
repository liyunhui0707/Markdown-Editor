const {focusNativeWindow,settleNativeCaret}=require('./helpers/document-native-selection.cjs');
const {createMarkdownCopy}=require('./helpers/document-file-actions.cjs');
const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('wrapped list/quote workflow: continued input, split/join, ranges, paste, exact save and recovery',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-wrapped-structures-')));await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),original=path.join(fixture.dir,'Structured.md'),target=path.join(fixture.dir,'Export.md');
 const nl='\r\n',list='- [X] Before **word**'+nl+'  continued tail'+nl+'- [ ] Middle *text*'+nl+'- [ ] End [**link** plain](../guide.md "keep title")';
 const quote='> Before **quote**  '+nl+'> continued tail'+nl+'> '+nl+'> End [**label** plain](quote "keep quote")';
 const nested='3) Parent'+nl+'   1) Child [**kid**](child "keep child")'+nl+'      continued child'+nl+'   12) End *last*'+nl+'   20) Keep **one**__two__'+nl+'8) Outside';
 const source='# Structured'+nl+nl+list+nl+'- Keep **one**__two__'+nl+nl+'Outside prose.'+nl+nl+quote+nl+'> '+nl+'> Keep quote.'+nl+nl+nested+nl+nl+'| A | B |'+nl+'| --- | --- |'+nl+'| C | D |'+nl;
 await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});let app,page,exit,expected=source,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const check=()=>expect.poll(async()=>(await snap())?.source).toBe(expected);
 const backup=()=>expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-wrapped-structures-session-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open','--document-drafts-test-root='+path.join(root,'drafts'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow,shell},{original,target,hidden})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:target});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;shell.showItemInFolder=()=>{};if(hidden)BrowserWindow.getAllWindows()[0].hide();else BrowserWindow.getAllWindows()[0].showInactive();},{original,target,hidden:process.env.DOCUMENT_WRAPPED_STRUCTURES_HIDDEN==='1'});
  await expect(page.locator('#empty-open')).toBeEnabled();
  await focusNativeWindow(app,page,process.env.DOCUMENT_WRAPPED_STRUCTURES_HIDDEN==='1');
 }
 async function stop(){if(app){await app.close();app=null;const e=await exit;exits.push(e);expect(e).toEqual({code:0,signal:null});}}
 async function select(a,aw,ao,b=a,bw=aw,bo=ao,reverse=false){
  await expect(page.locator('dialog[open]')).toHaveCount(0);await a.click();await page.locator('#editor .tiptap').focus();await settleNativeCaret(a);
  const data=await a.evaluate((node,{aw,ao,bw,bo,other,reverse})=>{
   const root=node.closest('.tiptap'),end=other?Array.from(root.querySelectorAll('p')).find(n=>n.textContent===other):node;
   if(!end)throw Error('end paragraph not found');
   function point(n,word,offset){const i=n.textContent.indexOf(word);if(i<0)throw Error('synthetic word missing');let at=0;const walk=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t;
    while(t=walk.nextNode()){if(i+offset>=at&&i+offset<=at+t.length)return [t,i+offset-at];at+=t.length;}throw Error('offset missing');}
   const x=point(node,aw,ao),y=point(end,bw,bo),v=root.editor.view,wanted={from:v.posAtDOM(...x),to:v.posAtDOM(...y)},s=getSelection();
   if(reverse)s.setBaseAndExtent(...y,...x);else s.setBaseAndExtent(...x,...y);return wanted;
  },{aw,ao,bw,bo,other:b===a?null:await b.textContent(),reverse});
  await expect.poll(()=>a.evaluate(n=>{const s=n.closest('.tiptap').editor.view.state.selection;return {from:s.from,to:s.to};})).toEqual(data);
 }
 const item=text=>page.locator('#editor .tiptap li p').filter({hasText:text}),quoted=text=>page.locator('#editor .tiptap blockquote p').filter({hasText:text});
 async function paste(node,text){await node.evaluate((node,text)=>{const e=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(e,'clipboardData',{value:{files:[],types:['text/plain','text/html'],getData:type=>type==='text/plain'?text:(()=>{throw Error('clipboard HTML read');})()}});node.dispatchEvent(e);},text);}
 try{
  await launch();await page.locator('#empty-open').click();await check();
  await select(item('Before '),'continued',3);await page.keyboard.insertText('新😀');expected=source.replace('continued tail','con新😀tinued tail');await check();await page.locator('#format-undo').click();expected=source;await check();
  await select(item('Before '),'word',2);await page.keyboard.press('Enter');expected=source.replace('**word**'+nl+'  continued tail','**wo**'+nl+'- [ ] **rd**'+nl+'  continued tail');await check();const splitTask=expected;
  await page.locator('#format-undo').click();expected=source;await check();await page.locator('#format-redo').click();expected=splitTask;await check();await select(item('rd continued'),'rd',0);await page.keyboard.press('Backspace');expected=source;await check();
  await select(quoted('Before '),'quote',2);await page.keyboard.press('Enter');expected=source.replace('**quote**  '+nl+'> continued tail','**qu**'+nl+'> '+nl+'> **ote**  '+nl+'> continued tail');await check();await select(quoted('continued tail'),'ote',0);await page.keyboard.press('Backspace');expected=source;await check();
  await select(item('Before '),'word',1,item('End link'),'link',2,true);await page.keyboard.insertText('新😀');expected=source.replace(list,'- [X] Before **w新😀**[**nk** plain](../guide.md "keep title")');await check();const typed=expected;
  await page.locator('#format-undo').click();expected=source;await check();await page.locator('#format-redo').click();expected=typed;await check();await page.locator('#format-undo').click();expected=source;await check();
  await select(item('Before '),'word',1,item('End link'),'link',2);await page.keyboard.press('Delete');expected=source.replace(list,'- [X] Before **w**[**nk** plain](../guide.md "keep title")');await check();
  await page.locator('#format-undo').click();expected=source;await check();
  await select(item('Before '),'word',1,item('End link'),'link',2,true);await paste(item('Before '),'One\r\nTwo😀');
  const pasted='- [X] Before **w**One'+nl+'- [ ] Two😀[**nk** plain](../guide.md "keep title")';expected=source.replace(list,pasted);await check();const savedPaste=expected;
  await page.locator('#format-undo').click();expected=source;await check();await page.locator('#format-redo').click();expected=savedPaste;await check();
  await expect(page.locator('#editor .tiptap > ul > li > .document-task-toggle').nth(0)).toHaveAttribute('aria-checked','true');await expect(page.locator('#editor .tiptap > ul > li > .document-task-toggle').nth(1)).toHaveAttribute('aria-checked','false');
  await select(item('Two😀'),'Two😀',5);await page.keyboard.insertText('继续');expected=expected.replace('Two😀','Two😀继续');await check();
  const beforeTaskJoin=expected;await select(item('Two😀'),'Two😀',0);await page.keyboard.press('Backspace');expected=beforeTaskJoin.replace('One'+nl+'- [ ] Two😀','OneTwo😀');await check();await page.locator('#format-undo').click();expected=beforeTaskJoin;await check();
  await select(quoted('Before '),'quote',1,quoted('End label'),'label',2,true);await paste(quoted('Before '),'引用一\n引用二');
  const pastedQuote='> Before **q**引用一'+nl+'> '+nl+'> 引用二[**bel** plain](quote "keep quote")';expected=expected.replace(quote,pastedQuote);await check();const beforeDelete=expected;
  await select(quoted('引用二'),'引用二',0);await page.keyboard.press('Backspace');expected=beforeDelete.replace('引用一'+nl+'> '+nl+'> 引用二','引用一引用二');await check();await page.locator('#format-undo').click();expected=beforeDelete;await check();
  await select(quoted('Before '),'引用一',1,quoted('引用二'),'引用二',1,true);await page.keyboard.press('Backspace');expected=beforeDelete.replace('引用一'+nl+'> '+nl+'> 引用二','引用二');await check();
  await page.locator('#format-undo').click();expected=beforeDelete;await check();
  await select(item('Child '),'kid',1,item('End last'),'last',2);await paste(item('Child '),'NestedA\nNestedB');
  const pastedNested='3) Parent'+nl+'   1) Child [**k**](child "keep child")NestedA'+nl+'   2) NestedB*st*'+nl+'   20) Keep **one**__two__'+nl+'8) Outside';expected=expected.replace(nested,pastedNested);await check();
  const afterNested=expected;await page.locator('#format-undo').click();expected=expected.replace(pastedNested,nested);await check();await page.locator('#format-redo').click();expected=afterNested;await check();
  await page.screenshot({path:info.outputPath('wrapped-structures.png')});expect(await page.locator('#editor .tiptap a[href]').count()).toBe(0);
  await page.locator('#show-source').click();await expect(page.locator('#source-editor .cm-content')).toContainText('[**nk** plain](../guide.md "keep title")');await page.keyboard.press('Escape');await check();await backup();expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);
  await page.locator('#save-original').click();await expect.poll(async()=>(await snap())?.dirty).toBe(false);expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);
  await createMarkdownCopy(page);await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);await backup();const saved=await snap(),id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,saved.label);
  await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await check();expect((await snap()).originalSave).toBeNull();expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }catch(e){if(page)await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({expected,actual:await snap(),errors,status:await page.locator('#viewer-status').textContent()},null,2));throw e;}
 finally{await stop();const archived=fixture.archive({quiescent:!app});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,archived,exits,errors,network,physicalIME:'NOT TESTED',dialogs:'controlled',hiddenNativeWindow:process.env.DOCUMENT_WRAPPED_STRUCTURES_HIDDEN==='1'},null,2));}
});
