const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('mixed inline authoring: native selection, batch replacement, export and recovery',async({},info)=>{
 test.setTimeout(120000);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-find-replace-')));
 const original=path.join(root,'article.md');
 const source='# alpha **beta** heading\r\n\r\nbefore **alpha** beta [safe](https://example.invalid "title") after\n\n> *alpha* beta quote\n\n- `alpha` beta list\n';
 await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),target=path.join(fixture.dir,'Mixed export.md');
 await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});
 let app,page,exit;const faults=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 async function launch(){
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts')],cwd:await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-replace-session-'))),env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));
  page=await app.firstWindow();page.on('pageerror',e=>faults.push(e.message));
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows()[0].showInactive();},original);
  await expect(page.locator('#empty-new')).toBeEnabled();
 }
 async function stop(){if(app){await app.close();app=null;const result=await exit;exits.push(result);expect(result).toEqual({code:0,signal:null});}}
 try{
  await launch();await page.locator('#empty-open').click();await page.locator('#show-document-find').click();await page.locator('#find-query').fill('alpha');
  await expect(page.locator('#find-replace-all')).toBeDisabled();await page.keyboard.press('Escape');
  await page.locator('#edit-copy').click();const initial=await snap();
  async function selectText(paragraph,word){await paragraph.click();
  await paragraph.evaluate((node,word)=>{const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);const nodes=[];let n;while(n=walker.nextNode())nodes.push(n);
   const text=node.textContent,start=text.indexOf(word),end=start+word.length;let at=0,a,b;
   for(const n of nodes){if(!a&&start>=at&&start<at+n.length)a=[n,start-at];if(end>at&&end<=at+n.length)b=[n,end-at];at+=n.length;}
   const r=document.createRange();r.setStart(...a);r.setEnd(...b);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);},word);
  }

  await selectText(page.locator('#editor .tiptap > p').first(),'alpha beta');
  await page.keyboard.insertText('中文😀');
  const native=source.replace('**alpha** beta [safe]','**中文😀** [safe]');
  await expect.poll(async()=>(await snap()).source).toBe(native);
  await page.keyboard.insertText('X');await expect.poll(async()=>(await snap()).source).toBe(native.replace('中文😀','中文😀X'));
  await page.locator('#format-undo').click();await expect.poll(async()=>(await snap()).source).toBe(native);
  await page.locator('#format-undo').click();await expect.poll(async()=>(await snap()).source).toBe(source);
  for(const [locator,word,value,expected] of [
    [page.locator('#editor .tiptap > h1'),'alpha beta','题名',source.replace('alpha **beta**','题名')],
    [page.locator('#editor .tiptap > p').first(),'safe after','链接',source.replace('[safe](https://example.invalid "title") after','[链接](https://example.invalid "title")')],
  ]){
    await selectText(locator,word);await page.keyboard.insertText(value);
    await expect.poll(async()=>(await snap())?.source).toBe(expected);
    await page.locator('#format-undo').click();await expect.poll(async()=>(await snap())?.source).toBe(source);
  }
  await page.locator('#show-document-find').click();await page.locator('#find-query').fill('alpha beta');await page.locator('#find-replacement').fill('中文😀');
  await page.locator('#find-replace-all').click();
  const edited=source.replace('alpha **beta**','中文😀').replace('**alpha** beta','**中文😀**').replace('*alpha* beta','*中文😀*').replace('`alpha` beta','`中文😀`');
  await expect.poll(async()=>(await snap()).source).toBe(edited);await expect(page.locator('#find-replace-status')).toHaveText('已替换 4 处，可撤销。');
  await page.keyboard.press('Escape');await page.locator('#format-undo').click();await expect.poll(async()=>(await snap()).source).toBe(source);
  await page.locator('#format-redo').click();await expect.poll(async()=>(await snap()).source).toBe(edited);
  const before=await snap();await expect.poll(async()=>{const s=await snap();return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showMessageBox=async()=>({response:1});},target);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);
  expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+edited);
  await page.locator('#open-confirmed-copy').click();await expect.poll(async()=>(await snap())?.readOnly).toBe(true);expect((await snap()).source).toBe(edited);
  // Recover the independently backed-up editing session in a fresh process.

  const id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,before.label);
  await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await expect.poll(async()=>(await snap())?.source).toBe(before.source);
  expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);expect(faults).toEqual([]);await stop();
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed:true,root,atomicUndo:true,restartExact:true,originalUnchanged:true,nativeIME:'NOT VERIFIED',exits,faults},null,2));
 }catch(e){if(page)console.log('replace-diagnostic',faults,await page.evaluate(async()=>({message:document.querySelector('#viewer-status').textContent,options:document.querySelector('#documents').innerHTML,drafts:await window.documentDemo.listDrafts()})));throw e;}finally{await stop();fixture.archive({quiescent:!app});}
});
