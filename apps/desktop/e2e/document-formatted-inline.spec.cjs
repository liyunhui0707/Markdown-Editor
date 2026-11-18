const {focusNativeWindow,settleNativeCaret}=require('./helpers/document-native-selection.cjs');
const {createMarkdownCopy}=require('./helpers/document-file-actions.cjs');
const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('formatted inline workflow: marks, link panel, history, source, save/export and exact restart',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-formatted-inline-')));await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),original=path.join(fixture.dir,'Formatted.md'),target=path.join(fixture.dir,'Export.md');
 const source='# **`code`** heading\r\n\r\nCreate **word** tail.\r\n\r\nBefore [**bold** plain *tail*](https://old.invalid "keep") after.\r\n\r\nFirst **line**\r\nA [**`inline`** label](https://old.invalid "article") Z\r\n\r\n- [ ] **`task`** item\r\n\r\n> *`quote`* text\r\n\r\n<div>protected</div>\r\n';
 await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});let app,page,exit,expected=source,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const check=()=>expect.poll(async()=>(await snap())?.source).toBe(expected);
 const backup=()=>expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-formatted-inline-session-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open','--document-drafts-test-root='+path.join(root,'drafts'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow,shell},{original,target,hidden})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:target});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;shell.showItemInFolder=()=>{};if(hidden)BrowserWindow.getAllWindows()[0].hide();else BrowserWindow.getAllWindows()[0].showInactive();},{original,target,hidden:process.env.DOCUMENT_FORMATTED_INLINE_HIDDEN==='1'});
  await expect(page.locator('#empty-open')).toBeEnabled();await focusNativeWindow(app,page,process.env.DOCUMENT_FORMATTED_INLINE_HIDDEN==='1');
 }
 async function stop(){if(app){await app.close();app=null;const e=await exit;exits.push(e);expect(e).toEqual({code:0,signal:null});}}
 async function select(node,word,caret=null){
  await expect(page.locator('dialog[open]')).toHaveCount(0);await node.click();
  await page.locator('#editor .tiptap').focus();await expect(page.locator('#editor .tiptap')).toBeFocused();await settleNativeCaret(node);
  const wanted=await node.evaluate((node,{word,caret})=>{
   const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),nodes=[];let n;while(n=walker.nextNode())nodes.push(n);
   const i=node.textContent.indexOf(word);if(i<0)throw Error('synthetic text not found');
   const from=caret===null?i:i+caret,to=caret===null?i+word.length:from;let at=0,a,b;
   for(const n of nodes){if(!a&&from>=at&&from<=at+n.length)a=[n,from-at];if(!b&&to>=at&&to<=at+n.length)b=[n,to-at];at+=n.length;}
   const view=node.closest('.tiptap').editor.view,wanted={from:view.posAtDOM(...a),to:view.posAtDOM(...b)};
   const r=document.createRange();r.setStart(...a);r.setEnd(...b);const s=getSelection();s.removeAllRanges();s.addRange(r);return wanted;
  },{word,caret});
  // Set the DOM range in the focused editor and acknowledge its exact PM
  // positions; DOM/PM agreement alone could still describe the old selection.
  await expect.poll(()=>node.evaluate(n=>{const v=n.closest('.tiptap').editor.view;return {from:v.state.selection.from,to:v.state.selection.to};})).toEqual(wanted).catch(async error=>{await fs.writeFile(info.outputPath('selection-failure.json'),JSON.stringify(await page.evaluate(()=>{const v=document.querySelector('.tiptap').editor.view,s=getSelection();return {pm:v.state.selection.toJSON(),dom:{from:v.posAtDOM(s.anchorNode,s.anchorOffset),to:v.posAtDOM(s.focusNode,s.focusOffset),text:s.toString()},active:document.activeElement?.outerHTML.slice(0,160),documentFocus:document.hasFocus(),viewFocus:v.hasFocus(),suppressing:v.domObserver.suppressingSelectionUpdates,mouseDown:!!v.input.mouseDown};}),null,2));throw error;});
 }

 try{
  await launch();await page.locator('#empty-open').click();await check();
  const heading=page.locator('#editor .tiptap > h1');
  await select(heading,'code');await page.locator('#format-italic').click();expected=expected.replace('**`code`**','**_`code`_**');await check();
  const marked=expected;await page.locator('#format-undo').click();expected=source;await check();await page.locator('#format-redo').click();expected=marked;await check();
  const create=page.locator('#editor .tiptap > p').filter({hasText:'Create'});
  await select(create,'word');await page.locator('#format-link').click();
  await expect(page.locator('#link-label')).not.toHaveAttribute('readonly');await expect(page.locator('#link-format-note')).toBeHidden();
  await page.locator('#link-href').fill('https://new.invalid/word');await page.locator('#link-apply').click();
  expected=expected.replace('**word**','**[word](<https://new.invalid/word>)**');await check();
  const link=page.locator('#editor .tiptap > p').filter({hasText:'Before'});
  await select(link,'bold',1);await page.locator('#format-link').click();
  await expect(page.locator('#link-label')).toHaveValue('bold plain tail');await expect(page.locator('#link-label')).toHaveAttribute('readonly','');
  await expect(page.locator('#link-format-note')).toBeVisible();await page.screenshot({path:info.outputPath('formatted-link-panel.png')});await page.locator('#link-href').fill('https://new.invalid/changed');await page.locator('#link-apply').click();
  expected=expected.replace('https://old.invalid "keep"','<https://new.invalid/changed> "keep"');await check();
  const addressed=expected;await select(link,'bold',1);await page.locator('#format-link').click();await page.locator('#link-remove').click();
  expected=expected.replace('[**bold** plain *tail*](<https://new.invalid/changed> "keep")','**bold** plain *tail*');await check();
  await page.locator('#format-undo').click();expected=addressed;await check();
  await select(link,'bold');await page.keyboard.insertText('中文😀');expected=expected.replace('**bold**','**中文😀**');await check();
  const article=page.locator('#editor .tiptap > p').filter({hasText:'First line'});
  await select(article,'inline');await page.locator('#format-italic').click();expected=expected.replace('**`inline`**','**_`inline`_**');await check();
  const task=page.locator('#editor .tiptap li').filter({hasText:'task'});
  await select(task,'task');await page.locator('#format-link').click();await page.locator('#link-href').fill('#task');await page.locator('#link-apply').click();
  expected=expected.replace('**`task`**','**[`task`](<#task>)**');await check();
  await select(heading,'code');await page.keyboard.insertText('代码');expected=expected.replace('`code`','`代码`');await check();
  expect(await page.locator('#editor .tiptap a[href]').count()).toBe(0);
  await select(link,'中文😀',1);await page.locator('#format-link').click();await page.keyboard.press('Escape');
  await expect(page.locator('#link-dialog')).not.toBeVisible();await expect(page.locator('#editor .tiptap')).toBeFocused();
  await page.locator('#show-source').click();await expect(page.locator('#source-editor .cm-content')).toContainText('[**中文😀** plain *tail*](<https://new.invalid/changed> "keep")');await page.keyboard.press('Escape');await check();await backup();expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);
  await page.locator('#save-original').click();await expect.poll(async()=>(await snap())?.dirty).toBe(false);expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);
  await createMarkdownCopy(page);await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);await backup();const saved=await snap(),id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,saved.label);
  await page.screenshot({path:info.outputPath('formatted-inline.png')});await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await check();expect((await snap()).originalSave).toBeNull();expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }catch(e){if(page)await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({expected,actual:await snap(),errors,status:await page.locator('#viewer-status').textContent()},null,2));throw e;}
 finally{await stop();const archived=fixture.archive({quiescent:!app});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,archived,exits,errors,network,physicalIME:'NOT TESTED',dialogs:'controlled',hiddenNativeWindow:process.env.DOCUMENT_FORMATTED_INLINE_HIDDEN==='1'},null,2));}
});
