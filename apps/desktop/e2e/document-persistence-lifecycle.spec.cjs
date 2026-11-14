const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID,createHash}=require('node:crypto');
const {createDraftStore}=require('../lib/document-draft-store');
const hash=b=>createHash('sha256').update(b).digest('hex');
test('persistence lifecycle: full workspace offload, automatic backup retry, independent restore and old-save archive',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-safe-create-lifecycle-'))),drafts=path.join(root,'drafts'),versions=path.join(root,'versions');
 const store=createDraftStore(drafts);let first,second;
 for(let i=0;i<64;i++){const id=store.newId(),r=store.save({id,label:'闲置草稿 '+i,revision:1,bytes:Buffer.from('归档正文 '+i)});expect(r.ok).toBe(true);if(i===0)first=id;if(i===1)second=id;expect(store.manage(id,'archive',store.list().drafts.find(r=>r.id===id).manageToken).ok).toBe(true);}
 fs.mkdirSync(versions,{mode:0o700});let oldId;
 for(let time=1;time<=3;time++){const id=randomUUID(),dir=path.join(versions,id);if(time===1)oldId=id;fs.mkdirSync(dir,{mode:0o700});
  const sha256=hash('new'),outcome={ok:true,state:'saved-confirmed',committed:true,sha256,revision:time};
  for(const [name,value] of Object.entries({'request.json':{filePath:'/synthetic/文件.md',sha256,expectedSha256:hash('prior'),time,revision:time},'outcome.json':outcome,'confirmed.json':outcome,'accepted.json':{sha256,revision:time},'prepared.json':{sha256}}))fs.writeFileSync(path.join(dir,name),JSON.stringify(value),{mode:0o600});
  for(const name of ['baseline.md','previous.md','exchanged.md','draft.md'])fs.writeFileSync(path.join(dir,name),name==='draft.md'?'new':'prior',{mode:0o600});
 }
 const app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+drafts,'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+versions],cwd:root,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
 const exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal}))),p=await app.firstWindow(),faults=[],requests=[];p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 const snap=()=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 let passed=false,restoredId;
 try{
  await app.evaluate(({dialog,BrowserWindow,shell})=>{dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;global.revealed=[];shell.showItemInFolder=file=>global.revealed.push(file);BrowserWindow.getAllWindows()[0].setContentSize(1280,850);});
  await p.locator('#empty-new').click();await p.locator('#editor .tiptap p').first().click();await p.keyboard.type('Live writing');
  await expect.poll(async()=>(await snap())?.draftBackup?.code).toBe('draft-record-capacity');
  await p.locator('#show-drafts').click();await expect(p.locator('#draft-recovery-status')).toContainText('128 / 128');await p.locator('#draft-archive-panel').evaluate(el=>el.open=true);
  await p.locator(`[data-draft-id="${first}"]`).getByRole('button',{name:'移入恢复归档',exact:true}).click();await p.locator('#confirm-draft-management').click();
  await expect(p.locator('#draft-operation-status')).toContainText('工作区名额已释放');await expect.poll(async()=>(await snap())?.draftBackup?.state).toBe('backed-up');
  const catalog=await p.evaluate(()=>window.documentDemo.listDrafts());const archived=catalog.archived.find(r=>r.offloaded);expect(archived).toBeTruthy();
  await p.locator(`[data-draft-id="${archived.id}"]`).getByRole('button',{name:'在 Finder 查看归档',exact:true}).click();await expect.poll(async()=>(await app.evaluate(()=>global.revealed))[0]).toContain(drafts+'-archive');
  await p.locator(`[data-draft-id="${archived.id}"]`).getByRole('button',{name:'恢复为新草稿',exact:true}).click();await p.locator('#confirm-draft-management').click();
  const fresh=await p.evaluate(()=>window.documentDemo.listDrafts());const restored=fresh.drafts.find(r=>r.label==='闲置草稿 0');expect(restored).toBeTruthy();restoredId=restored.id;expect(restoredId).not.toBe(first);
  await p.locator(`[data-draft-id="${restoredId}"]`).getByRole('button',{name:'恢复副本',exact:true}).click();await expect.poll(async()=>(await snap())?.source).toBe('归档正文 0');expect((await snap()).originalSave).toBeNull();expect((await snap()).linkedFile).toBeNull();
  await p.locator('#show-drafts').click();await expect(p.locator(`[data-draft-id="${restoredId}"]`).getByRole('button',{name:'移入恢复归档',exact:true})).toBeDisabled();
  const old=p.locator(`[data-record-id="${oldId}"]`);
  await old.getByRole('button',{name:'归档旧版本',exact:true}).click();await old.getByRole('button',{name:'确认归档旧版本',exact:true}).click();await expect(p.locator('#save-version-list')).toContainText('已归档，保存名额已释放');
  expect(fs.existsSync(path.join(versions+'-archive',oldId,'previous.md'))).toBe(true);
  await p.screenshot({path:info.outputPath('recovery-archive.png')});await p.locator('#close-draft-dialog').click();
  expect(faults).toEqual([]);expect(requests).toEqual([]);passed=true;
 }finally{await app.close();const ended=await exit;expect(ended).toEqual({code:0,signal:null});await fsp.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,restoredId,second,faults,requests,exit:ended,nativeIME:'NOT VERIFIED'},null,2));}
});
