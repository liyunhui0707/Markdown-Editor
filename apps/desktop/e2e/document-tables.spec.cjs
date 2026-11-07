const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createHomeFixture}=require('../test/helpers/home-fixture.cjs');
const {authorMixedDocument}=require('./common-authoring.cjs');
test('basic tables: create, cells, navigation, rows/columns, history, export/reopen and recovery',async({},info)=>{
 test.setTimeout(90000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-tables-e2e-'))),original=path.join(root,'Original.md');
 const originalBytes=Buffer.from('\ufeff# Keep\r\n\r\n| A | B |\r\n| :--- | ---: |\r\n| One | Two |\r\n');await fs.writeFile(original,originalBytes,{flag:'wx',mode:0o600});
 let app,exit,fixture,passed=false;const faults=[];
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
 const current=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 async function launch(){const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd,env,chromiumSandbox:true});
  exit=new Promise(r=>app.process().once('close',(code,signal)=>r({code,signal})));const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));
  await app.evaluate(({dialog,BrowserWindow},original)=>{dialog.showMessageBoxSync=()=>1;dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[original]});BrowserWindow.getAllWindows()[0].hide();},original);
  await expect(p.locator('#empty-new')).toBeEnabled();return p;
 }
 async function stop(){if(app){await app.close();app=null;expect(await exit).toEqual({code:0,signal:null});}}
 async function selectCell(p,index,all=false){
  const range=await p.locator('#editor table p').nth(index).evaluate((n,all)=>{const v=n.closest('.tiptap').editor.view;n.closest('.tiptap').focus();const selection=window.getSelection(),r=document.createRange();r.selectNodeContents(n);if(!all)r.collapse(false);selection.removeAllRanges();selection.addRange(r);document.dispatchEvent(new Event('selectionchange'));return[v.posAtDOM(r.startContainer,r.startOffset),v.posAtDOM(r.endContainer,r.endOffset)];},all);
  await expect.poll(()=>p.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(range);
 }
 try{
  let p=await launch();await p.locator('#empty-open').click();await expect(p.locator('#editor table')).toBeVisible();await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  await p.locator('#edit-copy').click();await selectCell(p,2,true);await p.keyboard.type('Edited');
  await expect.poll(async()=>(await current(p)).source).toBe('# Keep\r\n\r\n| A | B |\r\n| :--- | ---: |\r\n|Edited| Two |\r\n');expect(await fs.readFile(original)).toEqual(originalBytes);
  await p.locator('#new-temporary').click();await p.locator('#editor p').click();await p.locator('#insert-table').click();
  await expect(p.locator('#editor table p')).toHaveCount(6);await selectCell(p,0,true);await p.keyboard.type('Item');
  await p.keyboard.press('Tab');await p.keyboard.press('Meta+Shift+ArrowRight');await p.keyboard.type('Status');
  await selectCell(p,2);await p.keyboard.type('First');await p.keyboard.press('Tab');await p.keyboard.type('Ready');
  await p.keyboard.press('Enter');await p.keyboard.type('Next');await p.keyboard.press('Tab');await p.keyboard.type('Third');
  const source=async want=>expect.poll(async()=>(await current(p)).source).toBe(want);
  const base='|Item|Status|\n|---|---|\n|First|Ready|\n||Next|\n|Third||';await source(base);
  await p.locator('#table-add-column').click();await expect(p.locator('#editor tr').first().locator('th')).toHaveCount(3);
  const added=(await current(p)).source;await p.keyboard.press('Meta+z');await source(base);await p.keyboard.press('Meta+Shift+z');await source(added);
  await p.locator('#table-delete-column').click();await source(base);
  await p.locator('#table-add-row').click();await expect(p.locator('#editor tr')).toHaveCount(5);
  await p.locator('#table-delete-row').click();await source(base);
  // Text-only, single-cell paste and controlled composition fences.
  await selectCell(p,2,true);await p.locator('#editor .tiptap').evaluate(n=>{const d=new DataTransfer();d.setData('text/plain','第一项😀');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));});
  const final=base.replace('First','第一项😀');await source(final);
  await p.locator('#editor .tiptap').evaluate(n=>{const d=new DataTransfer();d.setData('text/plain','a\nb');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));});await source(final);
  await p.locator('#editor .tiptap').dispatchEvent('compositionstart');await expect(p.locator('#table-add-row')).toBeDisabled();
  await p.locator('#editor .tiptap').dispatchEvent('compositionend');await expect(p.locator('#table-add-row')).toBeEnabled();
  await p.screenshot({path:info.outputPath('table-editing.png')});
  await p.keyboard.press('Meta+Enter');await expect.poll(()=>p.locator('#editor .tiptap').evaluate(n=>n.editor.state.selection.$from.depth)).toBe(1);
  await p.keyboard.type('After table.');await source(final+'\n\nAfter table.');
  fixture=createHomeFixture('Writing-synthetic-E2E-');const target=path.join(fixture.dir,'Table.md');
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
  await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();await expect(p.locator('#open-confirmed-copy')).toBeVisible();
  const exported=await current(p),bytes=await fs.readFile(target),sha=crypto.createHash('sha256').update(bytes).digest('hex');expect(exported.confirmedCopy.state).toBe('created-confirmed');expect(exported.confirmedCopy.sha256).toBe(sha);expect(bytes.toString()).toBe(exported.source);fixture.recordFile('Table.md',bytes);
  await expect.poll(async()=>(await current(p)).draftBackup?.state).toBe('backed-up');
  const draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,exported.label);
  await p.locator('#open-confirmed-copy').click();await expect(p.locator('#editor table p').nth(2)).toHaveText('第一项😀');await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');expect((await current(p)).source).toBe(exported.source);
  await stop();p=await launch();await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
  expect((await current(p)).source).toBe(exported.source);expect((await current(p)).canUndo).toBe(false);await expect(p.locator('#editor table')).toBeVisible();await selectCell(p,2);await expect(p.locator('#table-add-row')).toBeEnabled();
  await p.screenshot({path:info.outputPath('table-recovered.png')});await stop();expect(faults).toEqual([]);expect(await fs.readFile(original)).toEqual(originalBytes);passed=true;
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({ok:true,root,originalUnchanged:true,exportSha256:sha,nativeDialogs:'controlled choices',nativeIME:'NOT VERIFIED',workflow:'readonly/copy/create/type/navigation/rows/columns/history/paste/export/reopen/restart-recover'},null,2));
 }finally{await stop();if(fixture)console.log('fixture:'+JSON.stringify(fixture.cleanup({passed,quiescent:!app})));}
});

test('structured document: mixed authoring, switching, export snapshot and restart recovery',async({},info)=>{
 test.setTimeout(90000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-structured-closeout-')));
 let app,exit,fixture,passed=false;const faults=[],exits=[];
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
 const current=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd,env,chromiumSandbox:true});
  exit=new Promise(r=>app.process().once('close',(code,signal)=>r({code,signal})));const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));
  await app.evaluate(({dialog,BrowserWindow})=>{dialog.showMessageBoxSync=()=>1;dialog.showMessageBox=async()=>({response:1});BrowserWindow.getAllWindows()[0].hide();});
  await expect(p.locator('#empty-new')).toBeEnabled();return p;
 }
 async function stop(){if(app){await app.close();app=null;const result=await exit;exits.push(result);expect(result).toEqual({code:0,signal:null});}}
 async function select(p,locator,all=false){
  const range=await locator.evaluate((n,all)=>{const v=n.closest('.tiptap').editor.view;n.closest('.tiptap').focus();const r=document.createRange();r.selectNodeContents(n);if(!all)r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));return[v.posAtDOM(r.startContainer,r.startOffset),v.posAtDOM(r.endContainer,r.endOffset)];},all);
  await expect.poll(()=>p.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(range);
 }
 try{
  let p=await launch();await p.locator('#empty-new').click();
  // Observe confirmed renderer state without injecting competing snapshot IPC.
  const source=()=>p.locator('#source').textContent();
  let body=await authorMixedDocument(p,source);
  const check=async want=>expect.poll(source).toBe(want);
  await select(p,p.locator('#editor .tiptap > p').last());await p.keyboard.press('Enter');await p.keyboard.type('- [ ] Plan');
  await p.keyboard.press('Enter');await p.keyboard.type('Child');await p.keyboard.press('Tab');
  body+='\n\n- [ ] Plan\n  - [ ] Child';await check(body);
  await p.keyboard.press('Enter');await p.keyboard.press('Shift+Tab');await p.keyboard.press('Enter');
  await check(body+'\n\n');await p.keyboard.type('Results');body+='\n\nResults';await check(body);
  await p.locator('#insert-table').click();const table='|列 1|列 2|\n|---|---|\n|||\n|||';await check(body+'\n\n'+table);
  await select(p,p.locator('#editor table p').nth(0),true);await p.keyboard.type('Item');
  await select(p,p.locator('#editor table p').nth(1),true);await p.keyboard.type('State');
  await select(p,p.locator('#editor table p').nth(2));await p.keyboard.type('Draft');await p.keyboard.press('Tab');await p.keyboard.type('Ready');
  let edited='|Item|State|\n|---|---|\n|Draft|Ready|\n|||';await check(body+'\n\n'+edited);
  await select(p,p.locator('#editor table p').nth(2),true);
  await p.locator('#editor .tiptap').evaluate(n=>{const d=new DataTransfer();d.setData('text/plain','文档😀');n.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));});
  edited=edited.replace('Draft','文档😀');await check(body+'\n\n'+edited);
  await p.locator('#table-add-column').click();await expect(p.locator('#editor tr').first().locator('th')).toHaveCount(3);
  await expect.poll(()=>p.locator('#status').textContent().then(s=>JSON.parse(s).historyPending)).toBe(false);const expanded=await source();
  await p.keyboard.press('Meta+z');await check(body+'\n\n'+edited);await p.keyboard.press('Meta+Shift+z');await check(expanded);
  await p.locator('#table-delete-column').click();await check(body+'\n\n'+edited);
  await p.keyboard.press('Meta+Enter');await p.keyboard.type('Tail');body+='\n\n'+edited+'\n\nTail';await check(body);
  await p.locator('#editor [role=checkbox]:visible').first().click();body=body.replace('- [ ] Plan','- [x] Plan');await check(body);
  const sessionId=await p.locator('#documents').inputValue();await p.locator('#new-temporary').click();
  await p.locator('#editor p').click();await p.keyboard.type('Other draft');await p.locator(`#session-list button[data-session-id="${sessionId}"]`).click();await check(body);
  await expect(p.locator('#editor table p').nth(2)).toHaveText('文档😀');await expect(p.locator('#editor [role=checkbox]:visible').first()).toHaveAttribute('aria-checked','true');
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(860,740);win.showInactive();});
  await select(p,p.locator('#editor table p').nth(2));await expect(p.locator('#table-tools')).toBeVisible();
  const widths=await p.evaluate(()=>({body:document.body.scrollWidth,viewport:innerWidth}));expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  await p.locator('#editor table').scrollIntoViewIfNeeded();
  await p.screenshot({path:info.outputPath('mixed-table-narrow.png')});
  fixture=createHomeFixture('Writing-synthetic-E2E-');const target=path.join(fixture.dir,'Mixed.md');
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);
  await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();await expect(p.locator('#open-confirmed-copy')).toBeVisible();
  const exported=await current(p),bytes=await fs.readFile(target),sha=crypto.createHash('sha256').update(bytes).digest('hex');
  expect(bytes.toString()).toBe(body);expect(exported.confirmedCopy.sha256).toBe(sha);expect(exported.confirmedCopy.state).toBe('created-confirmed');fixture.recordFile('Mixed.md',bytes);
  // Further edits remain in the draft; reopening the export must show its earlier revision.
  await select(p,p.locator('#editor .tiptap > p').last());await p.keyboard.type(' later');const final=body+' later';await check(final);
  expect(await fs.readFile(target)).toEqual(bytes);
  await expect.poll(async()=>{const s=await current(p);return s.draftBackup?.state==='backed-up' && s.draftBackup.revision===s.revision;}).toBe(true);
  const draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,exported.label);
  await p.locator('#open-confirmed-copy').click();await check(body);await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
  await expect(p.locator('#editor [role=checkbox]:visible').first()).toBeDisabled();await expect(p.locator('#table-tools')).toBeHidden();
  await stop();p=await launch();await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
  await check(final);const recovered=await current(p);expect(recovered.canUndo).toBe(false);expect(recovered.confirmedCopy??null).toBeNull();
  await expect(p.locator('#editor table p').nth(2)).toHaveText('文档😀');await expect(p.locator('#editor [role=checkbox]:visible').first()).toHaveAttribute('aria-checked','true');
  expect(await fs.readFile(target)).toEqual(bytes);await stop();expect(faults).toEqual([]);passed=true;
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({ok:true,root,exportSha256:sha,exportRevision:exported.revision,sourcePreserved:true,draftIncludesLaterEdits:true,exits,nativeDialogs:'controlled',clipboard:'controlled',nativeIME:'NOT VERIFIED'},null,2));
 }finally{await stop();if(fixture)console.log('fixture:'+JSON.stringify(fixture.cleanup({passed,quiescent:!app})));}
});
