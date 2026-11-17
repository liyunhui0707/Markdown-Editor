const {createMarkdownCopy}=require('./helpers/document-file-actions.cjs');
const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
const {syntheticPNG}=require('../test/helpers/synthetic-raster.cjs');
test('local image portability workflow: explicit collection, drop, exact history, save, move and recovery',async({},info)=>{
 test.setTimeout(150000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-image-portability-')));await fs.mkdir(info.outputDir,{recursive:true});
 const fixture=createSaveFolderFixture(info.outputDir),original=path.join(fixture.dir,'Article.md'),assets=path.join(fixture.dir,'images'),folder=path.join(fixture.dir,'Export'),moved=path.join(fixture.dir,'Moved');
 await fs.mkdir(assets);await fs.mkdir(folder);const target=path.join(folder,'Portable.md'),png=syntheticPNG(12),drop=syntheticPNG(13),hash=b=>createHash('sha256').update(b).digest('hex');
 const source='# Pictures\r\n\r\n![图示](<images/图%20示.png> "keep title")\r\n\r\n![Photo](images/photo.jpg)\r\n\r\nDrop here.\r\n\r\n![Remote](https://example.invalid/never.png)\r\n';
 await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});await fs.writeFile(path.join(assets,'图 示.png'),png,{flag:'wx',mode:0o600});
 let app,page,exit,expected=source,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const check=()=>expect.poll(async()=>(await snap())?.source).toBe(expected);
 const loaded=()=>page.locator('#editor img.document-local-image[src]');
 async function choose(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);}
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-portable-session-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();},target);
  await choose(original);await expect(page.locator('#empty-open')).toBeEnabled();
 }
 async function stop(){if(app){await app.close();app=null;const e=await exit;exits.push(e);expect(e).toEqual({code:0,signal:null});}}
 async function selectImage(index){await page.locator('#editor [data-document-image]').nth(index).click();await page.locator('#format-image').click();await expect(page.locator('#image-dialog')).toBeVisible();}
 async function backup(){await expect.poll(async()=>{const s=await snap();return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);}
 try{
  await launch();const jpeg=Buffer.from(await app.evaluate(({nativeImage},base64)=>Array.from(nativeImage.createFromBuffer(Buffer.from(base64,'base64')).toJPEG(85)),png.toString('base64')));await fs.writeFile(path.join(assets,'photo.jpg'),jpeg,{flag:'wx',mode:0o600});
  await page.locator('#empty-open').click();expect((await snap()).readOnly).toBe(false);expect((await snap()).originalSave?.available).toBe(true);await check();await expect(loaded()).toHaveCount(0);
  await selectImage(0);await page.screenshot({path:info.outputPath('collect-panel-normal.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(920,760));await page.screenshot({path:info.outputPath('collect-panel-narrow.png')});await expect(page.locator('#image-collect')).toBeInViewport();await expect(page.locator('#image-apply')).toBeInViewport();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,850));
  await page.locator('#image-collect').click();await expect(page.locator('#image-href')).toHaveValue(/^markdown-image-/);await check();await page.locator('#image-cancel').click();await check();
  const names=[];
  for(const [i,bytes] of [[0,png],[1,jpeg]]){
   await selectImage(i);await page.locator('#image-collect').click();await expect(page.locator('#image-href')).toHaveValue(/^markdown-image-/);const name=await page.locator('#image-href').inputValue();names.push(name);
   await page.locator('#image-apply').click();expected=i===0?expected.replace('images/图%20示.png',name):expected.replace('images/photo.jpg','<'+name+'>');await check();await expect(loaded()).toHaveCount(i+1);
   await expect(loaded().nth(i)).toHaveAttribute('src',`data:image/${i?'jpeg':'png'};base64,${bytes.toString('base64')}`);
  }
  await selectImage(2);await page.locator('#image-collect').click();await expect(page.locator('#image-error')).toContainText('未收集');await page.locator('#image-cancel').click();await check();
  const paragraph=page.locator('#editor .tiptap > p').filter({hasText:'Drop here.'});
  await paragraph.evaluate((node,base64)=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),data=new DataTransfer(),rect=node.getBoundingClientRect();data.items.add(new File([bytes],'drag.png',{type:'image/png'}));data.setData('text/html','<img src="https://example.invalid/drop">');node.dispatchEvent(new DragEvent('drop',{dataTransfer:data,clientX:rect.left+8,clientY:rect.top+rect.height/2,bubbles:true,cancelable:true}));},drop.toString('base64'));
  // Do not send snapshot IPC while the File arrayBuffer/import is settling:
  // preload intentionally refuses imports during any outstanding IPC.
  const dropped='markdown-image-'+hash(drop)+'.png',beforeDrop=expected;expected=expected.replace('Drop here.','Drop here.\r\n\r\n![拖入的图片](<'+dropped+'>)');await expect(loaded()).toHaveCount(3);await check();names.push(dropped);
  await page.locator('#format-undo').click();expected=beforeDrop;await check();await expect(loaded()).toHaveCount(2);await page.locator('#format-redo').click();expected=beforeDrop.replace('Drop here.','Drop here.\r\n\r\n![拖入的图片](<'+dropped+'>)');await check();await backup();
  await page.keyboard.press('Meta+s');await expect.poll(async()=>(await snap())?.dirty).toBe(false);expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+expected);
  expect(await fs.readFile(path.join(assets,'图 示.png'))).toEqual(png);expect(await fs.readFile(path.join(assets,'photo.jpg'))).toEqual(jpeg);
  await createMarkdownCopy(page);await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);
  const exported=await snap(),label=exported.label;expect(exported.confirmedCopy.attachments).toHaveLength(3);expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);
  for(const [i,bytes] of [png,jpeg,drop].entries())expect(await fs.readFile(path.join(folder,names[i]))).toEqual(bytes);
  await selectImage(0);await page.screenshot({path:info.outputPath('image-panel-normal.png')});await page.locator('#image-cancel').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(920,760));await selectImage(0);await page.screenshot({path:info.outputPath('image-panel-narrow.png')});expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);await page.locator('#image-cancel').click();
  await backup();const draft=(await page.evaluate(()=>window.documentDemo.listDrafts())).drafts.find(d=>d.label===label);expect(draft).toBeTruthy();await stop();
  await fs.rename(folder,moved);await launch();await choose(path.join(moved,'Portable.md'));await page.locator('#empty-open').click();await check();await expect(loaded()).toHaveCount(3);
  await stop();await fs.rename(assets,path.join(fixture.dir,'Retained-original-images'));await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${draft.id}"]`).getByRole('button',{name:'恢复副本'}).click();await check();await expect(loaded()).toHaveCount(3);expect((await snap()).canUndo).toBe(false);expect((await snap()).originalSave?.available===true).toBe(false);
  expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }catch(error){if(page&&!page.isClosed())await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({expected,snapshot:await snap(),notice:await page.locator('#viewer-status').textContent(),errors},null,2));throw error;}
 finally{await stop();const archive=fixture.archive({quiescent:!app});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,archive,exits,errors,network,originalImagesPreserved:true,nativeDialogs:'controlled',drag:'synthetic DataTransfer event; no system clipboard or physical drag claim'},null,2));}
});
