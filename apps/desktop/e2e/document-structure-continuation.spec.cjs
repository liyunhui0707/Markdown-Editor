const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('structure continuation workflow: linked boundaries, quote joins, table prose, save and recovery',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-structure-continuation-')));await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),original=path.join(fixture.dir,'Structure.md'),target=path.join(fixture.dir,'Export.md');
 const nl='\r\n',table='|A|B|'+nl+'|---|---|'+nl+'|c|d|';
 const prose='A **[word](word "keep")** Z',task='- [x] **[taskword](task "task title")**';
 const quote='> [**first**](one "keep")'+nl+'> '+nl+"> *[second](two 'keep')*";
 const source='# [Heading](head "title")'+nl+nl+prose+nl+nl+task+nl+nl+quote+nl+nl+table+nl+nl+'```js'+nl+'keep bytes'+nl+'```'+nl;
 await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});let app,page,exit,expected=source,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const check=()=>expect.poll(async()=>(await snap())?.source).toBe(expected);
 const backup=()=>expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-structure-continuation-session-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open','--document-drafts-test-root='+path.join(root,'drafts'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow,shell},{original,target,hidden})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:target});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;shell.showItemInFolder=()=>{};if(hidden)BrowserWindow.getAllWindows()[0].hide();else BrowserWindow.getAllWindows()[0].showInactive();},{original,target,hidden:process.env.DOCUMENT_STRUCTURE_HIDDEN==='1'});
  await expect(page.locator('#empty-open')).toBeEnabled();
 }
 async function stop(){if(app){await app.close();app=null;const e=await exit;exits.push(e);expect(e).toEqual({code:0,signal:null});}}
 async function select(node,word,caret=null){
  await expect(page.locator('dialog[open]')).toHaveCount(0);await node.click();
  await page.locator('#editor .tiptap').focus();await expect(page.locator('#editor .tiptap')).toBeFocused();
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
  const paragraph=page.locator('#editor .tiptap > p').filter({hasText:'A word Z'});
  await select(paragraph,'word',2);await page.keyboard.press('Enter');
  const split='A **[wo](word "keep")**'+nl+nl+'**[rd](word "keep")** Z';expected=expected.replace(prose,split);await check();
  await page.keyboard.press('Backspace');expected=source;await check();await page.locator('#format-undo').click();expected=source.replace(prose,split);await check();
  await page.locator('#format-redo').click();expected=source;await check();
  const item=page.locator('#editor .tiptap li p').filter({hasText:'taskword'});
  await select(item,'taskword',4);await page.keyboard.press('Enter');
  const splitTask='- [x] **[task](task "task title")**'+nl+'- [ ] **[word](task "task title")**';expected=expected.replace(task,splitTask);await check();
  await page.keyboard.insertText('新');expected=expected.replace('- [ ] **[word]', '- [ ] **[新word]');await check();
  const right=page.locator('#editor .tiptap li p').filter({hasText:'新word'});await select(right,'新word',0);await page.keyboard.press('Backspace');
  expected=expected.replace(splitTask.replace('- [ ] **[word]', '- [ ] **[新word]'),'- [x] **[task新word](task "task title")**');await check();
  const second=page.locator('#editor .tiptap blockquote p').filter({hasText:'second'});await select(second,'second',0);await page.keyboard.press('Backspace');
  const joined='> [**first**](one "keep")'+"*[second](two 'keep')*";expected=expected.replace(quote,joined);await check();
  const joinedState=expected;await page.locator('#format-undo').click();expected=expected.replace(joined,quote);await check();await page.locator('#format-redo').click();expected=joinedState;await check();
  const header=page.locator('#editor .tiptap th p').first();await select(header,'A',0);await expect(page.locator('#table-before')).toBeEnabled();
  await page.screenshot({path:info.outputPath('table-prose-controls.png')});await page.keyboard.press('Meta+Shift+Enter');
  expected=expected.replace(table,nl+nl+table);await check();await page.keyboard.insertText('表格前言');
  expected=expected.replace(joined+nl+nl+nl+nl+table,joined+nl+nl+'表格前言'+nl+nl+table);await check();
  await select(header,'A',0);let revision=(await snap()).revision;await page.keyboard.press('Shift+Tab');await check();
  expect((await snap()).revision).toBe(revision);await expect(page.locator('#editor .tiptap')).toBeFocused();
  await select(header,'A',0);await page.locator('#table-before').click();await check();expect((await snap()).revision).toBe(revision);
  await select(header,'A',0);await page.keyboard.press('Meta+Enter');expected=expected.replace(table,table+nl+nl);await check();
  await page.keyboard.insertText('表格后续');expected=expected.replace(table+nl+nl+nl+nl+'```js',table+nl+nl+'表格后续'+nl+nl+'```js');await check();
  await select(header,'A',0);revision=(await snap()).revision;await page.locator('#table-exit').click();await check();expect((await snap()).revision).toBe(revision);
  await page.locator('#show-source').click();await expect(page.locator('#source-editor .cm-content')).toContainText('[**first**](one "keep")');await page.keyboard.press('Escape');await check();await backup();expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);
  await page.locator('#save-original').click();await expect.poll(async()=>(await snap())?.dirty).toBe(false);expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);await backup();const saved=await snap(),id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,saved.label);
  await page.screenshot({path:info.outputPath('structure-continuation.png')});await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await check();expect((await snap()).originalSave).toBeNull();expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }catch(e){if(page)await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({expected,actual:await snap(),errors,status:await page.locator('#viewer-status').textContent()},null,2));throw e;}
 finally{await stop();const archived=fixture.archive({quiescent:!app});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,archived,exits,errors,network,physicalIME:'NOT TESTED',dialogs:'controlled',hiddenNativeWindow:process.env.DOCUMENT_STRUCTURE_HIDDEN==='1'},null,2));}
});
