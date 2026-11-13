const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
test('document replace: atomic batch, history, guarded structures, composition and restart',async({},info)=>{
 test.setTimeout(120000);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-find-replace-')));
 const original=path.join(root,'article.md');
 const source='# alpha\r\n\r\nalpha **alpha** [alpha](https://alpha.invalid)\n\n> alpha\n\n```js\nalpha\n```\n';
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
  await page.locator('#show-document-find').click();await page.locator('#find-query').fill('alpha');await page.locator('#find-replacement').fill('中文😀');
  await page.locator('#find-replace-all').click();const edited=source.replace(/alpha/g,(s,at)=>source.slice(at-8,at)==='https://'?s:'中文😀');
  await expect.poll(async()=>(await snap()).source).toBe(edited);expect((await snap()).revision).toBe(initial.revision+1);
  await expect(page.locator('#find-replace-status')).toHaveText('已替换 6 处，可撤销。');
  await page.keyboard.press('Escape');await expect(page.locator('#editor .tiptap')).toBeFocused();
  await page.locator('#format-undo').click();await expect.poll(async()=>(await snap()).source).toBe(source);
  await page.locator('#format-redo').click();await expect.poll(async()=>(await snap()).source).toBe(edited);
  await page.locator('#show-document-find').click();await page.locator('#find-query').fill('中文😀');await page.locator('#find-replacement').fill('beta');
  await page.locator('#find-replace-one').click();await expect.poll(async()=>(await snap()).source).toBe(edited.replace('中文😀','beta'));
  await page.locator('#find-replacement').dispatchEvent('compositionstart',{data:''});await expect(page.locator('#find-replace-all')).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator('#document-find')).toBeVisible();await page.locator('#find-replacement').dispatchEvent('compositionend',{data:''});
  await page.locator('#find-replacement').fill('**bold**');const before=await snap();await page.locator('#find-replace-all').click();await expect(page.locator('#find-replace-status')).toContainText('本次未替换');expect((await snap()).source).toBe(before.source);
  await page.locator('#find-query').fill('中文😀');await page.locator('#find-replacement').fill('');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(780,720));await page.screenshot({path:info.outputPath('replace-narrow.png')});
  await page.keyboard.press('Escape');await expect.poll(async()=>{const s=await snap();return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
  const id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,before.label);
  await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await expect.poll(async()=>(await snap())?.source).toBe(before.source);
  expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);expect(faults).toEqual([]);await stop();
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed:true,root,atomicUndo:true,restartExact:true,originalUnchanged:true,nativeIME:'NOT VERIFIED',exits,faults},null,2));
 }catch(e){if(page)console.log('replace-diagnostic',faults,await page.evaluate(async()=>({message:document.querySelector('#viewer-status').textContent,options:document.querySelector('#documents').innerHTML,drafts:await window.documentDemo.listDrafts()})));throw e;}finally{await stop();}
});
