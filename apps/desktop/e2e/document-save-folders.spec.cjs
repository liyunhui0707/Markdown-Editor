const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('nested save: edit original copy, export, reopen, refusal and cancellation preserve history',async({},info)=>{
 test.setTimeout(90000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 await fs.mkdir(info.outputDir,{recursive:true});const batch=createSaveFolderFixture(info.outputDir);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
 const original=path.join(root,'Original.md'),bytes=Buffer.from('\ufeff# Nested folders\r\n\r\nSynthetic original.\r\n');
 await fs.writeFile(original,bytes,{flag:'wx',mode:0o600});
 const destination=path.join(batch.dir,'Documents','文章','Desktop');await fs.mkdir(destination,{recursive:true,mode:0o700});
 const target=path.join(destination,'另存新文件.md');
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
 let app,exit,closed=false,result;const faults=[],requests=[];
 try{
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd:root,env,chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>{closed=true;resolve({code,signal});}));
  const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},{original,target})=>{dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:target});BrowserWindow.getAllWindows()[0].hide();},{original,target});
  const snap=()=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
  const save=async()=>{await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();};
  await p.locator('#empty-open').click();await p.locator('#edit-copy').click();
  await p.locator('#editor .tiptap p').click();await p.keyboard.press('End');await p.keyboard.insertText('X');
  await expect.poll(async()=>(await snap())?.source).toContain('Synthetic original.X');
  const draft=await snap();await save();await expect.poll(async()=>(await snap())?.copyState?.state).toBe('created-confirmed');
  const confirmed=await snap(),exported=await fs.readFile(target);expect(exported).toEqual(Buffer.from('\ufeff'+draft.source));
  expect(confirmed.copyState.sha256).toBe(createHash('sha256').update(exported).digest('hex'));
  for(const key of ['source','revision','dirty','canUndo'])expect(confirmed[key]).toEqual(draft[key]);
  await save();await expect.poll(async()=>(await snap())?.copyState?.code).toBe('target-exists');
  expect(await fs.readFile(target)).toEqual(exported);await expect(p.locator('#copy-summary-compact')).toContainText('另存新文件.md');
  await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});
  await save();await expect(p.locator('#copy-operation-alert')).toContainText('操作已取消');
  await p.locator('#format-undo').click();await expect.poll(async()=>(await snap())?.source).not.toContain('original.X');
  await p.locator('#format-redo').click();await expect.poll(async()=>(await snap())?.source).toBe(draft.source);
  await app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});},target);
  await p.locator('#open-file').click();await expect.poll(async()=>(await snap())?.readOnly).toBe(true);
  expect((await snap()).source).toBe(draft.source);expect(await fs.readFile(original)).toEqual(bytes);expect(await fs.readFile(target)).toEqual(exported);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1200,800);w.showInactive();});
  await p.screenshot({path:info.outputPath('nested-save-reopened.png')});expect(faults).toEqual([]);expect(requests).toEqual([]);
  result={ok:true,nestedExport:true,unicodePath:true,bomCRLF:true,readonlyReopen:true,originalUnchanged:true,existingFileProtected:true,cancellationAndHistory:true,sha256:confirmed.copyState.sha256,nativeDialogs:'controlled',nativeIME:'NOT VERIFIED'};
 }finally{
  if(app){await app.close();expect(await exit).toEqual({code:0,signal:null});}
  if(!app||closed){const archive=batch.archive({quiescent:true});await fs.writeFile(info.outputPath('fixture-archive.json'),JSON.stringify(archive,null,2));}
 }
 await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify(result,null,2));
});
