const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
const {stopOwnedElectron}=require('./helpers/document-owned-stop.cjs');
test('Markora quality workflow: semantic preview, heading range, quiet status, source save and reopen',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('Isolated Electron required');
 await fs.mkdir(info.outputDir,{recursive:true});const folder=createSaveFolderFixture(info.outputDir),file=path.join(folder.dir,'Markora synthetic.md');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-markora-')));
 const source='# Title **bold**\r\n\r\nOther *text*\r\n\r\n---\r\n\r\nEscaped \\*star\\* &amp;.\r\n\r\n[Reference][id]\r\n\r\n> Outer\r\n>\r\n> - child\r\n\r\n[id]: https://example.test "Keep"';
 await fs.writeFile(file,source,{flag:'wx',mode:0o600});let app,page,exit,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const idle=()=>expect.poll(()=>page.locator('#status').textContent().then(JSON.parse).then(s=>!s.pending&&!s.historyPending&&!s.locked)).toBe(true);
 try{
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open',
   '--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd:root,
   env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.show();},file);
  await expect(page.locator('.sidebar-brand strong')).toHaveText('Markora');await page.locator('#empty-open').click();await expect.poll(async()=>(await snap())?.source).toBe(source);
  await expect(page.locator('#editor .document-preview hr')).toHaveCount(1);await expect(page.locator('#editor .document-preview')).toContainText(['Escaped *star* &.','Reference','Outer']);
  expect(await page.locator('#editor .document-preview [href], #editor .document-preview img').count()).toBe(0);
  const beforeTitle=await page.title();await page.locator('#editor h1').click();
  await page.locator('#editor .tiptap').dispatchEvent('compositionstart',{data:''});await expect(page).toHaveTitle(beforeTitle);
  await page.locator('#editor .tiptap').dispatchEvent('compositionend',{data:''});await idle();
  const {projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs');const p=projectSource(source),a=p.spans.find(s=>s.bold),b=p.spans.find(s=>s.italic),from=a.from+1,to=b.to-1;
  const mapped=mapTextEdit(source,{from,to,insert:'中文😀'});expect(mapped.ok).toBe(true);
  await page.evaluate(({from,to})=>{const v=document.querySelector('#editor .tiptap').editor.view;v.focus();v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc,from,to)));},{from,to});
  await page.keyboard.insertText('中文😀');await idle();expect((await snap()).source).toBe(mapped.source);await expect(page).toHaveTitle(beforeTitle);
  await page.locator('#format-undo').click();await expect.poll(async()=>(await snap()).source).toBe(source);await page.locator('#format-redo').click();await expect.poll(async()=>(await snap()).source).toBe(mapped.source);
  await page.keyboard.press('Meta+s');await expect.poll(async()=>(await snap())?.dirty).toBe(false);expect(await fs.readFile(file,'utf8')).toBe(mapped.source);
  const refused=await snap();await page.evaluate(()=>{const v=document.querySelector('#editor .tiptap').editor.view;let at;v.state.doc.descendants((n,pos)=>{if(at===undefined&&n.type.name==='documentPreview')at=pos;});v.dispatch(v.state.tr.delete(at,at+1));});
  expect((await snap()).source).toBe(refused.source);await expect(page.locator('#viewer-status')).toContainText('内容已保留');await expect(page.locator('#viewer-edit-source')).toBeVisible();
  await page.screenshot({path:info.outputPath('semantic-writing.png')});await page.locator('#viewer-edit-source').click();await expect(page.locator('#source-dialog')).toBeVisible();
  await page.locator('#source-editor .cm-content').click();await page.keyboard.press('Meta+End');await page.keyboard.insertText('\n\nContinued after preview.');await page.keyboard.press('Meta+s');await expect(page.locator('#source-dialog')).not.toBeVisible();
  await expect.poll(async()=>(await snap())?.dirty).toBe(false);const saved=await snap();expect(await fs.readFile(file,'utf8')).toBe(saved.source);expect(saved.source).toContain('Continued after preview.');
  await page.locator('#close-current-document').click();await expect(page.locator('#empty-open')).toBeVisible();await page.locator('#empty-open').click();await expect.poll(async()=>(await snap())?.source).toBe(saved.source);
  await page.screenshot({path:info.outputPath('reopened-markora.png')});expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }finally{
  if(!passed&&page&&!page.isClosed()){
   await page.screenshot({path:info.outputPath('failure.png')}).catch(()=>{});
   const state=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent,notice:document.querySelector('#viewer-status')?.textContent,save:document.querySelector('#original-save-status')?.textContent})).catch(()=>null);
   await fs.writeFile(info.outputPath('failure-state.json'),JSON.stringify(state,null,2));
  }
  if(app){exits.push(await stopOwnedElectron({app,exit}));app=null;}
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,errors,network,exits,archive:folder.archive({quiescent:!app}),physicalIME:'NOT VERIFIED; controlled composition only'},null,2));
  if(passed)expect(exits).toEqual([{code:0,signal:null,forced:false}]);
 }
});
