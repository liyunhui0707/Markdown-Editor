const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
test('common Markdown compatibility: combined marks, soft lines, continuation, replace and recovery',async({},info)=>{
 test.setTimeout(120000);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-common-compat-')));
 await fs.mkdir(info.outputDir,{recursive:true});const fixture=createSaveFolderFixture(info.outputDir),target=path.join(fixture.dir,'Article.md');
 const source='# Article\r\n\r\nBefore **bold *both* tail** after.\r\n\r\nSoft first\r\nsecond 中文 line\nthird end.\r\n\r\n- [ ] **task *both* tail**\n- Next\n\n> **quote *both* tail**\n\n```js\nconst x=1;\n```\n\n| A | B |\n| --- | --- |\n| c | d |\n\n[link](https://example.invalid "keep")\n\n![diagram](assets/synthetic.png "keep")\n\n<div>protected</div>\n';
 const original=path.join(root,'Original.md');await fs.writeFile(original,'\ufeff'+source,{flag:'wx',mode:0o600});
 await fs.writeFile(info.outputPath('inputs.json'),JSON.stringify({root,original,target}));
 let app,page,exit;const faults=[],network=[],exits=[];let expected=source;
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const check=()=>expect.poll(async()=>(await snap())?.source===expected).toBe(true);
 async function launch(){
  const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-common-session-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts')],cwd,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>faults.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows()[0].hide();},original);
  await expect(page.locator('#empty-open')).toBeEnabled();
 }
 async function stop(){if(app){await app.close();app=null;const result=await exit;exits.push(result);expect(result).toEqual({code:0,signal:null});}}
 async function select(node,word,caret=null){await node.click();await node.evaluate((node,{word,caret})=>{
  const nodes=[],walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode())nodes.push(n);
  const start=node.textContent.indexOf(word);if(start<0)throw Error('Synthetic selection not found');
  const end=caret===null?start+word.length:start+caret,begin=caret===null?start:end;let offset=0,a,b;
  for(const n of nodes){if(!a&&begin>=offset&&begin<=offset+n.length)a=[n,begin-offset];if(!b&&end>=offset&&end<=offset+n.length)b=[n,end-offset];offset+=n.length;}
  const r=document.createRange();r.setStart(...a);r.setEnd(...b);const s=getSelection();s.removeAllRanges();s.addRange(r);
 },{word,caret});
 await expect.poll(()=>node.evaluate(n=>{const view=n.closest('.tiptap').editor.view,s=getSelection();return view.state.selection.from===Math.min(view.posAtDOM(s.anchorNode,s.anchorOffset),view.posAtDOM(s.focusNode,s.focusOffset))&&view.state.selection.to===Math.max(view.posAtDOM(s.anchorNode,s.anchorOffset),view.posAtDOM(s.focusNode,s.focusOffset));})).toBe(true);
 }
 try{
  await launch();await page.locator('#empty-open').click();await page.locator('#edit-copy').click();
  const before=page.locator('#editor .tiptap > p').filter({hasText:'Before'});
  await select(before,'both');await page.keyboard.insertText('中文😀');expected=expected.replace('*both*','*中文😀*');await check();
  await page.locator('#format-undo').click();expected=source;await check();await page.locator('#format-redo').click();expected=source.replace('*both*','*中文😀*');await check();
  await select(before,'bold');await page.locator('#format-italic').click();expected=expected.replace('**bold ','**_bold_ ');await check();
  const soft=page.locator('#editor .tiptap > p').filter({hasText:'Soft first'});
  await select(soft,'first second 中文');await page.keyboard.insertText('接续');expected=expected.replace('first\r\nsecond 中文','接续');await check();
  await select(page.locator('#editor .tiptap > p').filter({hasText:'Soft 接续'}),'Soft',2);await page.keyboard.press('Enter');expected=expected.replace('Soft 接续','So\n\nft 接续');await check();
  const item=page.locator('#editor li p').filter({hasText:'task both tail'});await select(item,'both',2);await page.keyboard.press('Enter');expected=expected.replace('- [ ] **task *both* tail**','- [ ] **task *bo***\n- [ ] ***th* tail**');await check();
  await page.keyboard.insertText('续');expected=expected.replace('***th* tail**','***续th* tail**');await check();
  await page.locator('#show-document-find').click();await page.locator('#find-query').fill('续th tail');await page.locator('#find-replacement').fill('任务');await page.locator('#find-replace-all').click();
  const undo=expected;expected=expected.replace('***续th* tail**','***任务***');await check();await expect(page.locator('#find-replace-status')).toHaveText('已替换 1 处，可撤销。');await page.keyboard.press('Escape');
  await page.locator('#format-undo').click();expected=undo;await check();await page.locator('#format-redo').click();expected=undo.replace('***续th* tail**','***任务***');await check();
  await page.locator('#show-source').click();await expect(page.locator('#source-editor .cm-content')).toBeVisible();await page.keyboard.press('Escape');await check();
  await expect.poll(async()=>{const s=await snap();return s?.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);const saved=await snap();
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showMessageBox=async()=>({response:1});},target);
  await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();await expect.poll(async()=>(await snap())?.confirmedCopy?.filePath).toBe(target);
  expect(await fs.readFile(target,'utf8')).toBe('\ufeff'+expected);await page.locator('#open-confirmed-copy').click();await expect.poll(async()=>(await snap())?.readOnly).toBe(true);await check();
  const id=await page.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,saved.label);
  await stop();await launch();await page.locator('#show-drafts').click();await page.locator(`[data-draft-id="${id}"]`).getByRole('button',{name:'恢复副本'}).click();await check();
  expect(await fs.readFile(original,'utf8')).toBe('\ufeff'+source);expect(faults).toEqual([]);expect(network).toEqual([]);await stop();
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed:true,exits,faults,network,exactHistory:true,exactBOMAndLineEndings:true,restartExact:true,nativeIME:'NOT VERIFIED'},null,2));
 }catch(error){if(page)await fs.writeFile(info.outputPath('failure.json'),JSON.stringify({root,expected,actual:await snap(),faults,status:await page.locator('#viewer-status').textContent()},null,2));throw error;
 }finally{await stop();fixture.archive({quiescent:!app});}
});
