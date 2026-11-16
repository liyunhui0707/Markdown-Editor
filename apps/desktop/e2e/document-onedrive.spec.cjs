const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {createOneDriveFixture}=require('../test/helpers/onedrive-fixture.cjs'),{syntheticPNG}=require('../test/helpers/synthetic-raster.cjs');
test('OneDrive local workflow: coordinated save, attachments, alias export, conflict and restart recovery',async({},info)=>{
 test.setTimeout(150000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 await fs.mkdir(info.outputDir,{recursive:true});const fixture=createOneDriveFixture(info.outputDir),original=path.join(fixture.dir,'Original.md'),target=path.join(fixture.dir,'Portable.md');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-onedrive-'))),initial='# OneDrive\r\n\r\nBefore.\r\n',png=syntheticPNG(29),href='markdown-image-'+createHash('sha256').update(png).digest('hex')+'.png';
 await fs.writeFile(original,'\ufeff'+initial,{flag:'wx',mode:0o600});let app,page,exit,expected=initial,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const check=()=>expect.poll(async()=>(await snap())?.source).toBe(expected);
 const backup=()=>expect.poll(async()=>{const s=await snap();return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-onedrive-session-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  let selected=target;if(fixture.kind==='real-onedrive')selected=path.join(os.homedir(),'OneDrive',path.relative(path.join(os.homedir(),'Library/CloudStorage',fixture.dir.split('/Library/CloudStorage/')[1].split('/')[0]),target));
  await app.evaluate(({dialog,BrowserWindow},{original,selected})=>{global.syntheticOneDriveConsents=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:selected});dialog.showMessageBox=async(_win,options)=>{global.syntheticOneDriveConsents.push(options.detail);return {response:1};};dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();},{original,selected});
  await expect(page.locator('#empty-open')).toBeEnabled();
 }
 async function stop(){if(app){await app.close();app=null;const e=await exit;exits.push(e);expect(e).toEqual({code:0,signal:null});}}
 try{
  await launch();await page.locator('#empty-open').click();const opened=await snap();expect(opened.readOnly).toBe(false);expect(opened.originalSave?.localProvider).toBe('onedrive');
  const paragraph=page.locator('#editor .tiptap > p').filter({hasText:'Before.'});await paragraph.click();await page.keyboard.press('Meta+ArrowRight');await page.keyboard.insertText(' Edited.');expected=initial.replace('Before.','Before. Edited.');await check();
  await paragraph.evaluate((node,base64)=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'synthetic.png',{type:'image/png'}));node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},png.toString('base64'));
  await expect(page.locator('#editor img.document-local-image')).toBeVisible();expected=expected.replace('Before. Edited.','Before. Edited.\r\n\r\n![粘贴的图片](<'+href+'>)');await check();await backup();
  await page.keyboard.press('Meta+s');await expect(page.locator('#original-save-status')).toContainText('本机文件写入');await expect.poll(async()=>(await snap())?.dirty).toBe(false);
  expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);expect(await fs.readFile(path.join(fixture.dir,href))).toEqual(png);
  const consents=await app.evaluate(()=>global.syntheticOneDriveConsents);expect(consents.some(s=>s?.includes('旧正文可能被同步'))).toBe(true);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect(page.locator('#test-copy-operation')).toContainText('OneDrive 本机文件写入');await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);
  expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);const exported=await snap();expect(exported.confirmedCopy.localProvider).toBe('onedrive');expect(exported.confirmedCopy.attachments).toHaveLength(1);
  await page.screenshot({path:info.outputPath('onedrive-saved-normal.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(920,760));await page.screenshot({path:info.outputPath('onedrive-saved-narrow.png')});expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#editor .tiptap > h1').click();await page.keyboard.press('Meta+ArrowRight');await page.keyboard.insertText(' More');expected=expected.replace('# OneDrive','# OneDrive More');await check();await backup();
  const external='# Synthetic external edit\n';await fs.writeFile(target,external);await page.keyboard.press('Meta+s');await expect.poll(async()=>(await snap())?.originalSave?.stopped).toBe(true);await check();expect(await fs.readFile(target,'utf8')).toBe(external);await expect(page.locator('#save-original')).toBeDisabled();await expect(page.locator('#original-save-status')).toContainText(/保存(?:已|仍)暂停/);
  const label=(await snap()).label,draft=(await page.evaluate(()=>window.documentDemo.listDrafts())).drafts.find(d=>d.label===label);expect(draft).toBeTruthy();await stop();
  await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${draft.id}"]`).getByRole('button',{name:'恢复副本'}).click();await check();await expect(page.locator('#editor img.document-local-image')).toBeVisible();expect((await snap()).originalSave?.available===true).toBe(false);expect((await snap()).canUndo).toBe(false);expect(await fs.readFile(target,'utf8')).toBe(external);
  expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }catch(error){if(page&&!page.isClosed())await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({expected,snapshot:await snap(),notice:await page.locator('#viewer-status').textContent(),errors},null,2));throw error;}
 finally{await stop();await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,fixture:fixture.finish({quiescent:!app}),provider:fixture.kind,exits,errors,network,cloudUpload:'not measured',nativeDialogs:'controlled',nativeIME:'NOT VERIFIED'},null,2));}
});
