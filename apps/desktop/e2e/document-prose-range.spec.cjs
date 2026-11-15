const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('formatted prose range workflow: native replacement, plain paste, joins, history, save and recovery',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-prose-range-')));await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),original=path.join(fixture.dir,'Writing.md'),target=path.join(fixture.dir,'Export.md');
 const nl='\r\n',first='First **bold**  '+nl+'continued *line*.',second='Second [link](../guide.md "keep title") tail.';
 const source='# Writing'+nl+nl+first+nl+nl+second+nl+nl+'Third `code` end.'+nl+nl+'- [ ] Keep **task**'+nl+'- Keep list'+nl+nl+'| A | B |'+nl+'| --- | --- |'+nl+'| C | D |'+nl;
 await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});let app,page,exit,expected=source,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const check=()=>expect.poll(async()=>(await snap())?.source).toBe(expected);
 const backup=()=>expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-prose-range-session-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open','--document-drafts-test-root='+path.join(root,'drafts'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow,shell},{original,target,hidden})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:target});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;shell.showItemInFolder=()=>{};if(hidden)BrowserWindow.getAllWindows()[0].hide();else BrowserWindow.getAllWindows()[0].showInactive();},{original,target,hidden:process.env.DOCUMENT_PROSE_RANGE_HIDDEN==='1'});
  await expect(page.locator('#empty-open')).toBeEnabled();
 }
 async function stop(){if(app){await app.close();app=null;const e=await exit;exits.push(e);expect(e).toEqual({code:0,signal:null});}}
 async function select(a,aw,ao,b=a,bw=aw,bo=ao,reverse=false){
  await expect(page.locator('dialog[open]')).toHaveCount(0);await a.click();await page.locator('#editor .tiptap').focus();
  const data=await a.evaluate((node,{aw,ao,bw,bo,other,reverse})=>{
   const root=node.closest('.tiptap'),end=other?Array.from(root.children).find(n=>n.tagName==='P'&&n.textContent.includes(other)):node;
   if(!end)throw Error('end paragraph not found');
   function point(n,word,offset){const i=n.textContent.indexOf(word);if(i<0)throw Error('synthetic word missing');let at=0;const walk=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t;
    while(t=walk.nextNode()){if(i+offset>=at&&i+offset<=at+t.length)return [t,i+offset-at];at+=t.length;}throw Error('offset missing');}
   const x=point(node,aw,ao),y=point(end,bw,bo),v=root.editor.view,wanted={from:v.posAtDOM(...x),to:v.posAtDOM(...y)},s=getSelection();
   if(reverse)s.setBaseAndExtent(...y,...x);else s.setBaseAndExtent(...x,...y);return wanted;
  },{aw,ao,bw,bo,other:b===a?null:await b.textContent(),reverse});
  await expect.poll(()=>a.evaluate(n=>{const s=n.closest('.tiptap').editor.view.state.selection;return {from:s.from,to:s.to};})).toEqual(data);
 }
 const prose=text=>page.locator('#editor .tiptap > p').filter({hasText:text});
 try{
  await launch();await page.locator('#empty-open').click();await check();
  await select(prose('First '),'bold',1,prose('Second '),'link',2,true);await page.keyboard.insertText('新😀');
  const replacement='First **b新😀**[nk](../guide.md "keep title") tail.';
  expected=source.replace(first+nl+nl+second,replacement);await check();const changed=expected;
  await page.locator('#format-undo').click();expected=source;await check();await page.locator('#format-redo').click();expected=changed;await check();await page.locator('#format-undo').click();expected=source;await check();
  await select(prose('First '),'bold',1,prose('Second '),'link',2,true);await page.keyboard.press('Backspace');expected=source.replace(first+nl+nl+second,'First **b**[nk](../guide.md "keep title") tail.');await check();
  await page.locator('#format-undo').click();expected=source;await check();
  await select(prose('First '),'bold',1,prose('Second '),'link',2);await prose('First ').evaluate(node=>{
   const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{files:[],types:['text/plain','text/html'],getData:type=>type==='text/plain'?'一段\r\n二段😀':(()=>{throw Error('clipboard HTML read');})()}});node.dispatchEvent(event);
  });
  const pasted='First **b**一段'+nl+nl+'二段😀[nk](../guide.md "keep title") tail.';expected=source.replace(first+nl+nl+second,pasted);await check();const afterPaste=expected;
  await page.locator('#format-undo').click();expected=source;await check();await page.locator('#format-redo').click();expected=afterPaste;await check();
  await select(prose('二段'),'二段😀',4);await page.keyboard.insertText('继续');expected=expected.replace('二段😀','二段😀继续');await check();const beforeJoin=expected;
  await select(prose('二段'),'二段😀',0);await page.keyboard.press('Backspace');expected=beforeJoin.replace('一段'+nl+nl+'二段','一段二段');await check();
  await page.locator('#format-undo').click();expected=beforeJoin;await check();
  await select(prose('First '),'一段',2);await page.keyboard.press('Delete');expected=beforeJoin.replace('一段'+nl+nl+'二段','一段二段');await check();
  await page.locator('#format-undo').click();expected=beforeJoin;await check();
  await page.screenshot({path:info.outputPath('formatted-prose.png')});expect(await page.locator('#editor .tiptap a[href]').count()).toBe(0);
  await page.locator('#show-source').click();await expect(page.locator('#source-editor .cm-content')).toContainText('[nk](../guide.md "keep title")');await page.keyboard.press('Escape');await check();await backup();expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);
  await page.locator('#save-original').click();await expect.poll(async()=>(await snap())?.dirty).toBe(false);expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);await backup();const saved=await snap(),id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,saved.label);
  await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await check();expect((await snap()).originalSave).toBeNull();expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }catch(e){if(page)await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({expected,actual:await snap(),errors,status:await page.locator('#viewer-status').textContent()},null,2));throw e;}
 finally{await stop();const archived=fixture.archive({quiescent:!app});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,archived,exits,errors,network,physicalIME:'NOT TESTED',dialogs:'controlled',hiddenNativeWindow:process.env.DOCUMENT_PROSE_RANGE_HIDDEN==='1'},null,2));}
});
