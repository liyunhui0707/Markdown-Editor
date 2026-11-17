const {createMarkdownCopy}=require('./helpers/document-file-actions.cjs');
const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('complex container workflow: paragraphs, nested quotes, native ranges, exact save and recovery',async({},info)=>{
 test.setTimeout(150000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-containers-')));await fs.mkdir(info.outputDir,{recursive:true});
 const fixture=createSaveFolderFixture(info.outputDir),original=path.join(fixture.dir,'Containers.md'),target=path.join(fixture.dir,'Export.md'),nl='\r\n';
 const list='- [X] First **word**'+nl+nl+'  Second [**label** plain](../guide.md "keep title")'+nl+'  continued'+nl+nl+'  - Child'+nl+'- Tail';
 const quote='> Outer'+nl+'> '+nl+'> > Before **quote**'+nl+'> > '+nl+'> > End [link](guide "keep quote")'+nl+'> '+nl+'> Tail quote';
 const source='# Containers'+nl+nl+list+nl+nl+quote+nl+nl+'```text'+nl+'Protected payload'+nl+'```'+nl;
 await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});let app,page,exit,expected=source,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const check=()=>expect.poll(async()=>(await snap())?.source).toBe(expected);
 const para=text=>page.locator('#editor .tiptap p').filter({hasText:text});
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-container-session-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},{original,target})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:target});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();},{original,target});
  await expect(page.locator('#empty-open')).toBeEnabled();
 }
 async function stop(){if(app){await app.close();app=null;const e=await exit;exits.push(e);expect(e).toEqual({code:0,signal:null});}}
 async function select(a,aw,ao,b=a,bw=aw,bo=ao,reverse=false){
  await a.click();await page.locator('#editor .tiptap').focus();
  const wanted=await a.evaluate((node,{aw,ao,bw,bo,other,reverse})=>{
   const root=node.closest('.tiptap'),end=other?Array.from(root.querySelectorAll('p')).find(n=>n.textContent===other):node;if(!end)throw Error('end paragraph missing');
   function point(n,word,offset){const i=n.textContent.indexOf(word);if(i<0)throw Error('word missing');let at=0;const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t;
    while(t=w.nextNode()){if(i+offset>=at&&i+offset<=at+t.length)return [t,i+offset-at];at+=t.length;}throw Error('point missing');}
   const x=point(node,aw,ao),y=point(end,bw,bo),v=root.editor.view,s=getSelection(),want={from:v.posAtDOM(...x),to:v.posAtDOM(...y)};
   if(reverse)s.setBaseAndExtent(...y,...x);else s.setBaseAndExtent(...x,...y);return want;
  },{aw,ao,bw,bo,other:b===a?null:await b.textContent(),reverse});
  await expect.poll(()=>a.evaluate(n=>{const s=n.closest('.tiptap').editor.state.selection;return {from:s.from,to:s.to};})).toEqual(wanted);
 }
 async function undo(){await page.locator('#format-undo').click();expected=source;await check();}
 async function paste(node,text){await node.evaluate((n,text)=>{const e=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(e,'clipboardData',{value:{files:[],types:['text/plain','text/html'],getData:type=>type==='text/plain'?text:(()=>{throw Error('HTML read');})()}});n.dispatchEvent(e);},text);}
 try{
  await launch();await page.locator('#empty-open').click();await check();await expect.poll(async()=>{const s=await snap();return !s.readOnly&&!!s.originalSave;}).toBe(true);await expect(page.locator('#editor .tiptap > ul > li').first().locator('p')).toHaveCount(3);
  await select(para('Second '),'continued',3);await page.keyboard.insertText('新😀');expected=source.replace('continued','con新😀tinued');await check();await undo();
  await select(para('Second '),'Second',3);await page.keyboard.press('Meta+Enter');expected=source.replace('Second','Sec'+nl+nl+'  ond');await check();const splitParagraph=expected;
  await page.locator('#format-undo').click();expected=source;await check();await page.locator('#format-redo').click();expected=splitParagraph;await check();await select(para('ond '),'ond',0);await page.keyboard.press('Backspace');expected=source;await check();
  await select(para('Second '),'Second',3);await page.keyboard.press('Enter');expected=source.replace('Second','Sec'+nl+nl+'- [ ] ond');await check();await select(para('ond '),'ond',0);await page.keyboard.press('Backspace');expected=source;await check();
  await page.locator('#editor .tiptap > ul > li > .document-task-toggle').first().click();expected=source.replace('[X]','[ ]');await check();await undo();
  await select(para('Before '),'quote',2);await page.keyboard.press('Enter');expected=source.replace('**quote**','**qu**'+nl+'> > '+nl+'> > **ote**');await check();await select(page.locator('#editor .tiptap p').filter({hasText:/^ote$/}),'ote',0);await page.keyboard.press('Backspace');expected=source;await check();
  await select(para('End link'),'End',1);await page.locator('#format-block').selectOption('blockquote');expected=source.replace('> > End','> > > End');await check();await page.locator('#format-block').selectOption('paragraph');expected=source;await check();
  await select(para('First '),'word',1,para('Second '),'label',2,true);await paste(para('First '),'One\nTwo😀');
  expected=source.replace(list,'- [X] First **w**One'+nl+nl+'  Two😀[**bel** plain](../guide.md "keep title")'+nl+'  continued'+nl+nl+'  - Child'+nl+'- Tail');await check();await undo();
  await select(para('Before '),'quote',1,para('End link'),'link',2,true);await page.keyboard.insertText('新😀');expected=source.replace('**quote**'+nl+'> > '+nl+'> > End [link](guide "keep quote")','**q新😀**[nk](guide "keep quote")');await check();await undo();
  await select(para('Second '),'Second',0,para('Second '),'Second',6);await page.locator('#format-italic').click();expected=source.replace('Second','*Second*');await check();await undo();
  await select(para('Second '),'continued',9);await page.keyboard.press('Meta+Enter');expected=source.replace('continued','continued'+nl+nl+'  ');await check();await page.keyboard.insertText('New paragraph');expected=expected.replace('continued'+nl+nl+'  ','continued'+nl+nl+'  New paragraph');await check();
  await page.screenshot({path:info.outputPath('containers-1280.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(920,760));await page.screenshot({path:info.outputPath('containers-920.png')});
  const visible=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return w.isVisible()&&!w.isMinimized();});expect(visible).toBe(true);expect(await page.locator('#editor .tiptap a[href]').count()).toBe(0);
  await page.locator('#show-source').click();await expect(page.locator('#source-editor .cm-content')).toContainText('New paragraph');await page.keyboard.press('Escape');await check();
  await expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);
  await page.locator('#save-original').click();await expect.poll(async()=>(await snap())?.dirty).toBe(false);expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);
  await createMarkdownCopy(page);await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);
  const saved=await snap(),id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,saved.label);await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await check();expect((await snap()).originalSave).toBeNull();expect((await snap()).linkedFile).toBeNull();expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }catch(e){if(page)await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({expected,actual:await snap(),errors,status:await page.locator('#viewer-status').textContent()},null,2));throw e;}
 finally{await stop();const archived=fixture.archive({quiescent:!app});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,archived,exits,errors,network,physicalIME:'NOT TESTED',dialogs:'controlled',nativeVisible:true},null,2));}
});
