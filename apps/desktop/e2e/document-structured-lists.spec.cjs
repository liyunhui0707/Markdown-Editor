const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createHomeFixture}=require('../test/helpers/home-fixture.cjs');
test('task and nested lists: native keys, checkbox, range paste, history, export and recovery',async({},info)=>{
 test.setTimeout(75000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-lists-e2e-'))),original=path.join(root,'Original.md');
 const originalBytes=Buffer.from('\ufeff# Original\r\n\r\n- [x] Retained\r\n  - Child\r\n');await fs.writeFile(original,originalBytes,{flag:'wx',mode:0o600});
 let app,fixture,passed=false,exit;const faults=[];
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};
 for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
 const current=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 async function launch(){const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd,env,chromiumSandbox:true});
  exit=new Promise(r=>app.process().once('close',(code,signal)=>r({code,signal})));
  const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));
  await app.evaluate(({dialog,BrowserWindow},original)=>{dialog.showMessageBoxSync=()=>1;dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});BrowserWindow.getAllWindows()[0].hide();},original);
  await expect(p.locator('#empty-new')).toBeEnabled();return p;
 }
 async function stop(){if(app){await app.close();app=null;expect(await exit).toEqual({code:0,signal:null});}}
 try{
 let p=await launch();await p.locator('#empty-open').click();await expect(p.locator('#editor .document-task-toggle:visible')).toBeDisabled();
 await p.locator('#edit-copy').click();await expect(p.locator('#editor .document-task-toggle:visible')).toBeEnabled();
 await p.locator('#editor .document-task-toggle:visible').click();await expect.poll(async()=>(await current(p)).source).toBe('# Original\r\n\r\n- [ ] Retained\r\n  - Child\r\n');
 expect(await fs.readFile(original)).toEqual(originalBytes);
 await p.locator('#new-temporary').click();await p.locator('#editor p').click();
 await p.keyboard.type('1. Parent');await p.keyboard.press('Enter');await p.keyboard.type('Child');await p.keyboard.press('Tab');
 await expect.poll(async()=>(await current(p)).source).toBe('1. Parent\n   1. Child');
 await p.keyboard.press('Enter');await p.keyboard.type('Grandchild');await p.keyboard.press('Tab');
 await expect.poll(async()=>(await current(p)).source).toBe('1. Parent\n   1. Child\n      1. Grandchild');
 await p.keyboard.press('Shift+Tab');await expect.poll(async()=>(await current(p)).source).toBe('1. Parent\n   1. Child\n   1. Grandchild');
 await p.locator('#new-temporary').click();await p.locator('#editor p').click();
 const source=async want=>expect.poll(async()=>(await current(p)).source).toBe(want);
 const key=async(k,want)=>{await p.keyboard.press(k);await source(want);};
 await p.keyboard.type('- [ ] Plan');await source('- [ ] Plan');
 await expect(p.locator('#editor [role=checkbox]')).toHaveAttribute('aria-checked','false');
 await p.locator('#editor [role=checkbox]').click();await source('- [x] Plan');
 await key('Meta+z','- [ ] Plan');await key('Meta+Shift+z','- [x] Plan');
 await p.locator('#editor li p').click();await p.keyboard.press('Meta+ArrowRight');await key('Enter','- [x] Plan\n- [ ] ');
 await p.keyboard.type('Step');await source('- [x] Plan\n- [ ] Step');
 await key('Tab','- [x] Plan\n  - [ ] Step');
 await key('Enter','- [x] Plan\n  - [ ] Step\n  - [ ] ');await p.keyboard.type('Next');await source('- [x] Plan\n  - [ ] Step\n  - [ ] Next');
 // A real DOM selection across sibling nested paragraphs, paste into one surviving item.
 const range=await p.locator('#editor .tiptap').evaluate(n=>{const ps=n.querySelectorAll('li p'),a=ps[1].firstChild,b=ps[2].firstChild;n.focus();window.getSelection().setBaseAndExtent(b,2,a,2);document.dispatchEvent(new Event('selectionchange'));return[n.editor.view.posAtDOM(a,2),n.editor.view.posAtDOM(b,2)];});
 await expect.poll(()=>p.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(range);
 await p.locator('#editor .tiptap').evaluate(n=>{const data=new DataTransfer();data.setData('text/plain','合并😀');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
 const merged='- [x] Plan\n  - [ ] St合并😀xt';await source(merged);
 await key('Meta+z','- [x] Plan\n  - [ ] Step\n  - [ ] Next');await key('Meta+Shift+z',merged);
 await p.locator('#editor li p').nth(1).click();await p.keyboard.press('Meta+ArrowRight');await key('Shift+Tab','- [x] Plan\n- [ ] St合并😀xt');
 await key('Enter','- [x] Plan\n- [ ] St合并😀xt\n- [ ] ');await key('Enter','- [x] Plan\n- [ ] St合并😀xt\n\n');
 await p.keyboard.type('Tail');await source('- [x] Plan\n- [ ] St合并😀xt\n\nTail');
 // Keep a nested unchecked child through export and fresh-process recovery.
 await p.locator('#editor li p').nth(1).click();await p.keyboard.press('Meta+ArrowRight');await key('Tab','- [x] Plan\n  - [ ] St合并😀xt\n\nTail');
 await p.locator('#editor .tiptap > p').last().click();
 // Composition gate is controlled-event coverage, not native IME acceptance.
 await p.locator('#editor .tiptap').dispatchEvent('compositionstart');await expect(p.locator('#editor [role=checkbox]').first()).toBeDisabled();
 await p.locator('#editor .tiptap').dispatchEvent('compositionend');await p.waitForTimeout(50);await expect(p.locator('#editor [role=checkbox]').first()).toBeEnabled();
 fixture=createHomeFixture('Writing-synthetic-E2E-');const target=path.join(fixture.dir,'Lists.md');
 await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
 await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();await expect(p.locator('#open-confirmed-copy')).toBeVisible();
 const exported=await current(p);expect(exported.confirmedCopy.state).toBe('created-confirmed');const bytes=await fs.readFile(target);const sha=crypto.createHash('sha256').update(bytes).digest('hex');expect(sha).toBe(exported.confirmedCopy.sha256);fixture.recordFile('Lists.md',bytes);
 await expect.poll(async()=>(await current(p)).draftBackup?.state).toBe('backed-up');
 const draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,exported.label);
 await p.locator('#open-confirmed-copy').click();await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');expect((await current(p)).source).toBe(exported.source);
 await expect(p.locator('#editor [role=checkbox]').first()).toBeDisabled();await p.screenshot({path:info.outputPath('lists-readonly.png')});
 await stop();p=await launch();await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
 const restored=await current(p);expect(restored.source).toBe(exported.source);expect(restored.canUndo).toBe(false);expect(restored.confirmedCopy??null).toBeNull();
 await expect(p.locator('#editor [role=checkbox]').first()).toBeEnabled();await expect(p.locator('#editor [role=checkbox]').first()).toHaveAttribute('aria-checked','true');
 await p.screenshot({path:info.outputPath('lists-editing.png')});await stop();expect(faults).toEqual([]);expect(await fs.readFile(original)).toEqual(originalBytes);passed=true;
 await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({ok:true,root,originalUnchanged:true,exportSha256:sha,nativeDialogs:'stubbed choices',nativeIME:'NOT VERIFIED',workflow:'typing/check/uncheck/indent/outdent/sibling paste/undo/redo/exit/export/reopen/recover'},null,2));
 }finally{await stop();if(fixture)console.log('fixture:'+JSON.stringify(fixture.cleanup({passed,quiescent:!app})));}
});
