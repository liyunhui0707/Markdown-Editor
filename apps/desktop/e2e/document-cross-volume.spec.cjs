const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
test('cross-volume writing: open, exact save/history, local and external recovery, fresh export',async({},info)=>{
 test.setTimeout(90000);const volume=process.env.DOCUMENT_CROSS_VOLUME_ROOT;if(!volume||!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated synthetic volume and Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-cross-volume-'))),dir=await fs.mkdtemp(path.join(volume,'ui-'));await fs.mkdir(info.outputDir,{recursive:true});
 const original=path.join(dir,'文章.md'),target=path.join(dir,'导出.md'),bytes=Buffer.from('\ufeff# Article\r\n\r\nOriginal paragraph.\r\n');await fs.writeFile(original,bytes,{flag:'wx',mode:0o600});
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];let app,passed=false;const errors=[];
 const snap=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 try{
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open','--document-drafts-test-root='+path.join(root,'drafts'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd:root,env,chromiumSandbox:true});
  const page=await app.firstWindow();if(process.env.DOCUMENT_CROSS_VOLUME_HIDDEN==='1')await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({dialog,shell},{original,target})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:target});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;global.reveals=[];shell.showItemInFolder=p=>global.reveals.push(p);},{original,target});
  await page.locator('#empty-open').click();await expect.poll(async()=>(await snap(page))?.originalSave?.filePath).toBe(original);const initial=await snap(page);
  const edited=await page.evaluate(async s=>window.documentDemo.sourceEdit({sessionId:s.sessionId,expectedRevision:s.revision,from:0,to:0,insert:'New 中文\r\n\r\n'}),initial);expect(edited.ok).toBe(true);
  // Select another session and back through the public UI to refresh its controller.
  await page.locator('#new-temporary').click();await page.locator(`.session-row[data-session-id="${initial.sessionId}"]`).click();await expect.poll(async()=>(await snap(page))?.draftBackup?.state).toBe('backed-up');
  const current=await snap(page);await page.locator('#save-original').click();await expect.poll(async()=>(await snap(page))?.dirty).toBe(false);expect(await fs.readFile(original)).toEqual(Buffer.from('\ufeff'+current.source));
  await page.locator('#format-undo').click();await expect.poll(async()=>(await snap(page))?.dirty).toBe(true);await page.locator('#format-redo').click();await expect.poll(async()=>(await snap(page))?.dirty).toBe(false);
  await page.locator('#show-drafts').click();await expect(page.getByRole('button',{name:'查看目标卷恢复区'})).toHaveCount(1);await page.getByRole('button',{name:'查看目标卷恢复区'}).click();expect((await app.evaluate(()=>global.reveals))[0]).toContain('.markdown-recovery-');await page.screenshot({path:info.outputPath('cross-volume-recovery.png')});
  await page.locator('#close-draft-dialog').click();await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snap(page))?.confirmedCopy?.filePath).toBe(target);expect(await fs.readFile(target)).toEqual(Buffer.from('\ufeff'+current.source));expect(errors).toEqual([]);passed=true;
 }finally{if(app)await app.close();await fs.writeFile(info.outputPath('cross-volume-ui.json'),JSON.stringify({passed,root,dir,errors,dialogs:'controlled',physicalInput:'NOT TESTED'},null,2));}
});
