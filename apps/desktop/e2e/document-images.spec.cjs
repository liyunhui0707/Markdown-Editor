const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createHomeFixture}=require('../test/helpers/home-fixture.cjs');
test('image references: panel, keyboard, history, exclusive export, reopen and recovery without fetching',async({},info)=>{
 test.setTimeout(90000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-images-e2e-'))),original=path.join(root,'Original.md');
 const originalBytes=Buffer.from('\ufeffBefore\r\n\r\n![old](assets/old.png "keep title")\r\n\r\nAfter');await fs.writeFile(original,originalBytes,{flag:'wx',mode:0o600});
 let app,exit,fixture,passed=false;const faults=[],requests=[],exits=[];
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
 const current=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 async function launch(){const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd,env,chromiumSandbox:true});
  exit=new Promise(r=>app.process().once('close',(code,signal)=>r({code,signal})));const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},original)=>{dialog.showMessageBoxSync=()=>1;dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});BrowserWindow.getAllWindows()[0].hide();},original);
  await expect(p.locator('#empty-new')).toBeEnabled();return p;
 }
 async function stop(){if(app){await app.close();app=null;const result=await exit;exits.push(result);expect(result).toEqual({code:0,signal:null});}}
 const image=p=>p.locator('#editor [data-document-image]');
 async function selectedImage(p,index=0){await image(p).nth(index).click();await expect.poll(()=>p.locator('#editor .tiptap').evaluate(n=>n.editor.state.selection.node?.type.name)).toBe('documentImage');}
 try{
  let p=await launch();await p.locator('#empty-open').click();await expect(image(p)).toHaveCount(1);await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  await p.locator('#edit-copy').click();const source=()=>p.locator('#source').textContent(),check=async s=>expect.poll(source).toBe(s);
  await selectedImage(p);await p.locator('#format-image').click();await expect(p.locator('#image-href')).toHaveValue('assets/old.png');
  await p.locator('#image-label').fill('cancelled');await p.locator('#image-cancel').click();await check(originalBytes.toString().slice(1));
  await p.locator('#format-image').click();await p.locator('#image-label').fill('New diagram');await p.locator('#image-apply').click();
  const edited=originalBytes.toString().slice(1).replace('![old]','![New diagram]');await check(edited);
  await p.keyboard.press('Meta+z');await check(originalBytes.toString().slice(1));await p.keyboard.press('Meta+Shift+z');await check(edited);
  await p.locator('#format-image').click();await p.locator('#image-remove').click();await expect(image(p)).toHaveCount(0);await p.keyboard.press('Meta+z');await check(edited);expect(await fs.readFile(original)).toEqual(originalBytes);
  await p.locator('#new-temporary').click();await p.locator('#editor p').click();await p.locator('#format-image').click();
  await p.locator('#image-label').fill('流程图😀');await p.locator('#image-href').fill('javascript:alert(1)');await p.locator('#image-apply').click();await expect(p.locator('#image-error')).not.toBeEmpty();await check('');
  await p.locator('#image-href').fill('assets/my diagram.png');await p.locator('#image-form').dispatchEvent('compositionstart');await expect(p.locator('#image-apply')).toBeDisabled();await p.locator('#image-form').dispatchEvent('compositionend');
  await p.locator('#image-apply').click();let body='![流程图😀](<assets/my diagram.png>)';await check(body);await expect(image(p)).toContainText('未加载预览');
  await p.keyboard.press('Enter');await p.keyboard.type('After image.');body+='\n\nAfter image.';await check(body);
  await p.locator('#format-image').click();await p.locator('#image-label').fill('Remote reference');await p.locator('#image-href').fill('https://example.test/diagram.png');await p.locator('#image-apply').click();body+='\n\n![Remote reference](<https://example.test/diagram.png>)';await check(body);
  await p.keyboard.press('Backspace');await expect(image(p)).toHaveCount(1);await p.keyboard.press('Meta+z');await check(body);
  await p.keyboard.press('Enter');await p.keyboard.type('Tail');body+='\n\nTail';await check(body);
  await selectedImage(p,1);await p.locator('#format-image').click();await p.locator('#image-href').fill('https://example.test/new.png');await p.locator('#image-apply').click();body=body.replace('example.test/diagram','example.test/new');await check(body);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1000,780);w.showInactive();});
  await p.screenshot({path:info.outputPath('image-cards.png')});await p.locator('#format-image').click();await p.screenshot({path:info.outputPath('image-panel.png')});await p.locator('#image-cancel').click();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(780,720));await p.locator('#show-reading-settings').click();await p.locator('#reading-theme-dark').click();await p.locator('#close-reading-settings').click();await p.screenshot({path:info.outputPath('image-narrow-dark.png')});await p.locator('#format-image').click();await p.screenshot({path:info.outputPath('image-panel-dark.png')});await p.locator('#image-cancel').click();
  expect(await p.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);await expect(p.locator('#editor img,#editor [src],#editor [href]')).toHaveCount(0);
  fixture=createHomeFixture('Writing-synthetic-E2E-');const target=path.join(fixture.dir,'Images.md');await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
  await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();await expect(p.locator('#open-confirmed-copy')).toBeVisible();
  const exported=await current(p),bytes=await fs.readFile(target),sha=crypto.createHash('sha256').update(bytes).digest('hex');expect(bytes.toString()).toBe(body);expect(exported.confirmedCopy.state).toBe('created-confirmed');expect(exported.confirmedCopy.sha256).toBe(sha);fixture.recordFile('Images.md',bytes);
  await expect.poll(async()=>{const s=await current(p);return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
  const draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,exported.label);
  await p.locator('#open-confirmed-copy').click();await check(body);await expect(image(p)).toHaveCount(2);await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  await stop();p=await launch();await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
  await expect.poll(()=>p.locator('#source').textContent()).toBe(body);await expect(image(p)).toHaveCount(2);const recovered=await current(p);expect(recovered.canUndo).toBe(false);expect(recovered.confirmedCopy??null).toBeNull();
  await selectedImage(p);await p.locator('#format-image').click();await expect(p.locator('#image-href')).toHaveValue('assets/my diagram.png');await p.locator('#image-cancel').click();
  expect(await fs.readFile(original)).toEqual(originalBytes);expect(await fs.readFile(target)).toEqual(bytes);await stop();expect(faults).toEqual([]);expect(requests).toEqual([]);passed=true;
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({ok:true,root,exits,originalUnchanged:true,exportSha256:sha,exportRevision:exported.revision,requests,previewLoaded:false,nativeDialogs:'controlled',nativeIME:'NOT VERIFIED'},null,2));
 }finally{await stop();if(fixture)console.log('fixture:'+JSON.stringify(fixture.cleanup({passed,quiescent:!app})));}
});
