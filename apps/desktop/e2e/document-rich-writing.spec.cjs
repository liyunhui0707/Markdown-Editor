const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('rich long writing: headings, formatted paragraphs, source, history, export and recovery',async({},info)=>{
 test.setTimeout(180000);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-rich-writing-')));
 await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),target=path.join(fixture.dir,'Rich writing.md');
 const body=Array.from({length:600},(_,i)=>`## Chapter ${i} **bold** heading.\n\nParagraph ${i} **bold** *italic* \`code\` ${'中文 🌿 ordinary text. '.repeat(25)}target.\n\n`).join('');
 const source='# Rich writing\r\n\r\n'+body+'[ref]: https://example.invalid\n\n[reference][ref]\n\n| a | b |\n| --- | --- |\n| c | d |\n';
 const original=path.join(root,'Synthetic article.md');await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});
 await fs.writeFile(info.outputPath('inputs.json'),JSON.stringify({root,original,target}));
 let app,page,exit;const faults=[],rounds=[],exits=[],sessionRoots=[];let expected=source;
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-rich-session-')));sessionRoots.push(cwd);
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>faults.push(e.message));
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.hide();},original);
  await expect(page.locator('#empty-open')).toBeEnabled();
 }
 async function stop(){if(app){await app.close();app=null;const result=await exit;exits.push(result);expect(result).toEqual({code:0,signal:null});}}
 try{
  await launch();await page.locator('#empty-open').click();await page.locator('#edit-copy').click();
  for(const [selector,index,marker] of [['p',0,'target.'],['h2',300,'## Chapter 300 **bold** heading.'],['p',599,'target.']]){
   const node=page.locator(`#editor .tiptap > ${selector}`).nth(index);await node.click();
   await node.evaluate(n=>{const range=document.createRange();range.selectNodeContents(n);range.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(range);});
   const text='abcdefghijklmnop',start=Date.now();await page.keyboard.type(text,{delay:50});
   const raw=selector==='h2'?marker:`Paragraph ${index} **bold** *italic* \`code\` ${'中文 🌿 ordinary text. '.repeat(25)}target.`;
   expected=expected.replace(raw,raw+text);await expect.poll(async()=>(await snap())?.source===expected).toBe(true);
   rounds.push({selector,index,units:text.length,elapsedMs:Date.now()-start});
   await page.locator('#format-undo').click();await expect.poll(async()=>(await snap())?.source).toBe(expected.replace(raw+text,raw+text.slice(0,-1)));
   await page.locator('#format-redo').click();await expect.poll(async()=>(await snap())?.source===expected).toBe(true);
  }
  await page.locator('#show-source').click();await expect(page.locator('#source-editor .cm-content')).toBeVisible();await page.keyboard.press('Escape');
  await page.locator('#show-document-find').click();await page.locator('#find-query').fill('target.');await expect(page.locator('#find-count')).toHaveText('1 / 600');await page.keyboard.press('Escape');
  await expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);const before=await snap();
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showMessageBox=async()=>({response:1});},target);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);
  expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);await page.locator('#open-confirmed-copy').click();await expect.poll(async()=>(await snap())?.readOnly).toBe(true);expect((await snap()).source).toBe(expected);
  const id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,before.label);
  await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await expect.poll(async()=>(await snap())?.source===expected).toBe(true);
  expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);expect(faults).toEqual([]);await stop();
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed:true,sessionRoots,textUnits:source.length,rounds,exits,faults,exactHistory:true,sourceUnchangedOutsideEdits:true,restartExact:true,nativeIME:'NOT VERIFIED'},null,2));
 }catch(error){
  const diagnostic=page?await page.evaluate(async()=>({status:document.querySelector('#status').textContent,viewerStatus:document.querySelector('#viewer-status').textContent,documents:[...document.querySelector('#documents').options].map(o=>({id:o.value,label:o.text})),draftStatus:document.querySelector('#draft-recovery-status').textContent})):{};
  await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({root,sessionRoots,rounds,exits,faults,diagnostic},null,2));throw error;
 }finally{await stop();fixture.archive({quiescent:!app});}
});
