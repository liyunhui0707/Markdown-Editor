const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
test('recent documents and resume writing: restart, readonly reopen, changed target refusal and clear',async({},info)=>{
  test.setTimeout(60000);
  if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('Explicit isolated Electron required');
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-recents-e2e-')));
  const original=path.join(root,'Article <synthetic>.md'),bytes=Buffer.from('\ufeff# Synthetic article\r\n\r\nOriginal paragraph.\r\n');
  await fs.writeFile(original,bytes,{flag:'wx',mode:0o600});
  const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};
  for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
  let app,exited;const exits=[],faults=[];
  async function launch(){
    app=await electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd:path.resolve(__dirname,'..'),env,chromiumSandbox:true});
    exited=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));
    app.process().stderr.on('data',b=>{if(/Uncaught Exception|Object has been destroyed/.test(String(b)))faults.push(String(b));});
    const page=await app.firstWindow();page.on('pageerror',e=>faults.push(e.message));
    await app.evaluate(({dialog,BrowserWindow})=>{dialog.showMessageBoxSync=()=>1;dialog.showMessageBox=async()=>({response:1});BrowserWindow.getAllWindows()[0].hide();});
    await expect(page.locator('#empty-new')).toBeEnabled();await expect(page.locator('#show-recents')).toBeEnabled();return page;
  }
  async function stop(){if(app){await app.close();app=null;const e=await exited;exits.push(e);expect(e).toEqual({code:0,signal:null});}}
  const current=async page=>page.evaluate(async()=>{const sessionId=document.querySelector('#documents').value;return (await window.documentDemo.snapshot({sessionId})).snapshot;});
  try{
    let page=await launch();await expect(page.locator('#welcome-recent-list button')).toHaveCount(0);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},original);
    await page.locator('#empty-open').click();await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    await page.locator('#edit-copy').click();await page.locator('#editor .tiptap p').click();await page.keyboard.press('End');await page.keyboard.insertText(' Continued draft.');
    await expect.poll(async()=> (await current(page)).source).toContain('Continued draft.');
    const source=(await current(page)).source;
    await expect.poll(async()=> (await current(page)).draftBackup?.state).toBe('backed-up');await stop();
    page=await launch();await expect(page.locator('#welcome-recent-list button')).toHaveCount(1);await expect(page.locator('#welcome-draft-list button')).toHaveCount(1);
    await expect(page.locator('#welcome-recent-list strong')).toHaveText('Article <synthetic>.md');
    await page.screenshot({path:info.outputPath('welcome.png')});
    await page.locator('#welcome-draft-list button').click();await expect.poll(async()=> (await current(page)).source).toBe(source);
    expect((await current(page)).readOnly).toBe(false);expect((await current(page)).canUndo).toBe(false);
    await page.locator('#show-recents').click();await expect(page.locator('#recent-list button')).toBeEnabled();await page.locator('#recent-list button').click();
    await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');expect((await current(page)).source).toBe(bytes.toString('utf8').slice(1));
    expect(await fs.readFile(original)).toEqual(bytes);const live=await current(page);
    await fs.writeFile(original,'External synthetic update.');
    await page.locator('#show-recents').click();await expect(page.locator('#recent-list button')).toBeEnabled();await page.locator('#recent-list button').click();
    await expect(page.locator('#viewer-status')).toContainText('最近文档已变化');expect((await current(page)).sessionId).toBe(live.sessionId);expect((await current(page)).source).toBe(live.source);
    await page.locator('#show-recents').click();await expect(page.locator('#clear-recents')).toBeEnabled();await page.locator('#clear-recents').click();await expect(page.locator('#recent-list button')).toHaveCount(0);
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(680,800);w.showInactive();});
    await page.screenshot({path:info.outputPath('recent-narrow.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
    expect(await fs.readFile(original,'utf8')).toBe('External synthetic update.');await stop();
    page=await launch();await expect(page.locator('#welcome-recent-list button')).toHaveCount(0);await expect(page.locator('#welcome-draft-list button')).toHaveCount(1);await stop();
    expect(faults).toEqual([]);
    await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({root,exits,originalSha256:createHash('sha256').update(bytes).digest('hex'),restartHistory:true,recovery:true,changedRefused:true,clearSurvivesRestart:true,nativeDialogs:'controlled',nativeIME:'NOT VERIFIED'},null,2));
  }finally{await stop();}
});
