const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('source authoring preserves raw bytes, pending buffer, history, export and restart recovery',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-source-authoring-'))),original=path.join(root,'Source.md');
 const source='---\r\nname: synthetic\r\n---\n\n# Source article\r\n\r\nOpening paragraph.\r\n\r\n<div>inert<script>window.sourceExecuted=true</script></div>\r\n\n[ref]: https://example.invalid\rFinal 中文😀\n';
 const originalBytes=Buffer.from('\ufeff'+source);await fs.writeFile(original,originalBytes,{flag:'wx',mode:0o600});
 await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),folder=path.join(fixture.dir,'Nested');await fs.mkdir(folder,{mode:0o700});
 const target=path.join(folder,'Source export.md'),env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};
 for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
 let app,exit,result;const faults=[],requests=[],exits=[];
 const snap=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const backup=async p=>expect.poll(async()=>{const s=await snap(p);return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd,env,chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));const p=await app.firstWindow();
  p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.showInactive();},original);
  await expect(p.locator('#empty-new')).toBeEnabled();return p;
 }
 async function stop(){if(app){await app.close();app=null;const r=await exit;exits.push(r);expect(r).toEqual({code:0,signal:null});}}
 async function replaceWord(p,word,replacement){await p.keyboard.press('Meta+f');const input=p.locator('#source-editor .cm-search input[name=search]');await input.fill('');await input.pressSequentially(word);await input.press('Enter');await input.press('Escape');await p.keyboard.insertText(replacement);}
 try{
  let p=await launch();await p.locator('#empty-open').click();await p.locator('#show-source').click();expect(await p.locator('#source-text').textContent()).toBe(source);await expect(p.locator('#apply-source')).toBeHidden();await p.keyboard.press('Escape');
  await p.locator('#edit-copy').click();const initial=await snap(p);await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toBeVisible();
  await p.keyboard.press('Meta+ArrowUp');await p.keyboard.type('abc');await p.locator('#source-undo').click();await expect(p.locator('#source-metadata')).not.toContainText('尚未应用');await expect(p.locator('#source-editor .cm-line').first()).toHaveText('---');await p.locator('#source-redo').click();await expect(p.locator('#source-metadata')).toContainText('尚未应用');await p.locator('#source-undo').click();
  await replaceWord(p,'synthetic','edited');const edited=source.replace('synthetic','edited');expect((await snap(p)).source).toBe(source);
  await p.keyboard.press('Meta+o');await expect(p.locator('#source-dialog')).toBeVisible();expect((await snap(p)).sessionId).toBe(initial.sessionId);
  await p.locator('#close-source').click();await expect(p.locator('#source-discard')).toBeVisible();await p.locator('#keep-source').click();
  await p.locator('#source-undo').click();await expect(p.locator('#source-metadata')).not.toContainText('尚未应用');await p.locator('#source-redo').click();await expect(p.locator('#source-metadata')).toContainText('尚未应用');
  const content=p.locator('#source-editor .cm-content');await content.dispatchEvent('compositionstart',{data:''});await expect(p.locator('#apply-source')).toBeDisabled();await expect(p.locator('#close-source')).toBeDisabled();await content.dispatchEvent('compositionend',{data:''});await expect(p.locator('#apply-source')).toBeEnabled();
  await p.screenshot({path:info.outputPath('source-edit-light.png')});await p.locator('#apply-source').click();await expect(p.locator('#source-dialog')).toBeHidden();
  await expect.poll(async()=>(await snap(p)).source).toBe(edited);expect((await snap(p)).revision).toBe(initial.revision+1);expect(await p.evaluate(()=>window.sourceExecuted)).toBeUndefined();
  await p.locator('#format-undo').click();await expect.poll(async()=>(await snap(p)).source).toBe(source);await p.locator('#format-redo').click();await expect.poll(async()=>(await snap(p)).source).toBe(edited);
  const paragraph=p.locator('#editor .tiptap > p').first();await paragraph.click();await p.keyboard.press('End');await p.keyboard.insertText(' continued');const continued=edited.replace('Opening paragraph.','Opening paragraph. continued');await expect.poll(async()=>(await snap(p)).source).toBe(continued);
  await p.locator('#show-source').click();await replaceWord(p,'edited','discarded');await p.keyboard.press('Escape');await p.locator('#discard-source').click();expect((await snap(p)).source).toBe(continued);
  await p.locator('#show-reading-settings').click();await p.locator('#reading-theme-dark').click();await p.locator('#close-reading-settings').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(780,720));
  await p.locator('#show-source').click();expect(await p.locator('#source-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth&&n.scrollHeight<=n.clientHeight)).toBe(true);await p.screenshot({path:info.outputPath('source-edit-dark-narrow.png')});await p.keyboard.press('Escape');await backup(p);
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},target);await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snap(p))?.confirmedCopy?.filePath).toBe(target);
  const bytes=await fs.readFile(target),exported=await snap(p);expect(bytes).toEqual(Buffer.from('\ufeff'+continued));expect(exported.confirmedCopy.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
  await p.locator('#show-source').click();await replaceWord(p,'edited','later');await p.locator('#source-editor .cm-content').press('Meta+s');await expect(p.locator('#source-dialog')).toBeHidden();const later=continued.replace('edited','later');await expect.poll(async()=>(await snap(p)).source).toBe(later);expect((await snap(p)).confirmedCopy).toEqual(exported.confirmedCopy);await backup(p);
  const draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,(await snap(p)).label);await stop();p=await launch();await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
  const restored=await snap(p);expect(restored.source).toBe(later);expect(restored.bom).toBe(true);expect(restored.canUndo).toBe(false);expect(restored.confirmedCopy??null).toBeNull();await p.locator('#show-source').click();await replaceWord(p,'later','restored');await p.locator('#apply-source').click();await expect.poll(async()=>(await snap(p)).source).toBe(later.replace('later','restored'));await backup(p);
  expect(await fs.readFile(original)).toEqual(originalBytes);expect(await fs.readFile(target)).toEqual(bytes);expect(faults).toEqual([]);expect(requests).toEqual([]);await stop();
  result={ok:true,root,originalUnchanged:true,mixedEndingsExact:true,bom:true,sourceHistory:true,richEditingAfterSource:true,pendingBufferProtected:true,exportHash:exported.confirmedCopy.sha256,restartExact:true,exits,nativeDialogs:'controlled',nativeIME:'NOT VERIFIED'};
 }catch(error){if(app){const p=await app.firstWindow();console.log('diagnostic',await p.locator('#source-status').textContent(),await p.locator('#status').textContent(),faults);await p.screenshot({path:info.outputPath('failure.png')}).catch(()=>{});}throw error;}
 finally{await stop();const archive=fixture.archive({quiescent:!app});await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({...result,ok:!!result,archive,root,exits,faults,requests},null,2));}
});
