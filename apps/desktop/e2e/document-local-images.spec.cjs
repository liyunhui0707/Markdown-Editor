const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {createHomeFixture}=require('../test/helpers/home-fixture.cjs');
function fixturePNG(){
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);body.copy(b,4);b.writeUInt32BE(crc(body),b.length-4);return b;};
 const header=Buffer.alloc(13);header.writeUInt32BE(240);header.writeUInt32BE(120,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc(120*(240*3+1));for(let y=0;y<120;y++)for(let x=0;x<240;x++){const p=y*721+1+x*3;pixels[p]=60+x/3;pixels[p+1]=100+y;pixels[p+2]=130;}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
test('local images: choose, preview, exact attachments export, reuse, readonly reopen and recovered draft',async({},info)=>{
 test.setTimeout(150000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated runtime required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-local-images-e2e-'))),original=path.join(root,'Original.md'),picture=path.join(root,'selected.png');
 const originalBytes=Buffer.from('\ufeff# Picture notes\r\n\r\nBefore image.\r\n');const png=fixturePNG();await fs.writeFile(original,originalBytes,{mode:0o600,flag:'wx'});await fs.writeFile(picture,png,{mode:0o600,flag:'wx'});
 let app,exit,fixture,passed=false;const faults=[],requests=[],exits=[];
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};for(const k of ['TMPDIR','TMP','TEMP'])if(process.env[k])env[k]=process.env[k];
 const current=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 async function launch(){const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd,env,chromiumSandbox:true});
  exit=new Promise(r=>app.process().once('close',(code,signal)=>r({code,signal})));const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showMessageBoxSync=()=>1;dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});BrowserWindow.getAllWindows()[0].hide();},original);
  await expect(p.locator('#empty-new')).toBeEnabled();return p;
 }
 async function stop(){if(app){await app.close();app=null;const result=await exit;exits.push(result);expect(result).toEqual({code:0,signal:null});}}
 const loaded=p=>p.locator('#editor img[src]');
 async function choose(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);}
 async function exportTo(p,target){await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},target);await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();await expect(p.locator('#open-confirmed-copy')).toBeVisible();await expect.poll(async()=> (await current(p))?.confirmedCopy?.filePath).toBe(target);}
 try{
  let p=await launch();await p.locator('#empty-open').click();await p.locator('#edit-copy').click();await p.locator('#editor p').click();await p.locator('#format-image').click();
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});await p.locator('#image-choose').click();await expect(p.locator('#image-choose')).toBeEnabled();await expect(p.locator('#image-href')).toHaveValue('');
  await choose(picture);await p.locator('#image-choose').click();await expect(p.locator('#image-href')).toHaveValue(/^markdown-image-/);await p.locator('#image-label').fill('本地合成图片');await p.locator('#image-apply').click();
  await expect(loaded(p)).toHaveCount(1);await expect.poll(()=>loaded(p).evaluate(n=>n.naturalWidth)).toBe(240);
  const withFirst=await p.locator('#source').textContent();await p.keyboard.press('Meta+z');await expect(loaded(p)).toHaveCount(0);await p.keyboard.press('Meta+Shift+z');await expect(loaded(p)).toHaveCount(1);await expect(p.locator('#source')).toHaveText(withFirst);
  const jpeg=path.join(root,'selected.jpg');const jpg=Buffer.from(await app.evaluate(({nativeImage},base64)=>Array.from(nativeImage.createFromBuffer(Buffer.from(base64,'base64')).toJPEG(85)),png.toString('base64')));await fs.writeFile(jpeg,jpg,{flag:'wx',mode:0o600});
  await p.keyboard.press('Enter');await p.keyboard.type('After image.');await expect(p.locator('#source')).toContainText('After image.');await p.locator('#format-image').click();await choose(jpeg);await p.locator('#image-choose').click();await expect(p.locator('#image-href')).toHaveValue(/\.jpg$/);await p.locator('#image-label').fill('JPEG preview');await p.locator('#image-apply').click();await expect(loaded(p)).toHaveCount(2);await expect.poll(()=>loaded(p).nth(1).evaluate(n=>n.naturalWidth)).toBe(240);
  await expect.poll(async()=>{const s=await current(p);return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true);
  fixture=createHomeFixture('Writing-synthetic-E2E-');const target=path.join(fixture.dir,'Pictures.md');await exportTo(p,target);
  const exported=await current(p),bytes=await fs.readFile(target);expect(bytes).toEqual(Buffer.from('\ufeff'+exported.source));expect(exported.confirmedCopy.attachments).toHaveLength(2);fixture.recordFile('Pictures.md',bytes);
  for(const a of exported.confirmedCopy.attachments){const b=await fs.readFile(a.filePath);expect(crypto.createHash('sha256').update(b).digest('hex')).toBe(a.sha256);expect(b).toEqual(a.name.endsWith('.png')?png:jpg);fixture.recordFile(a.name,b);}
  expect(await fs.readFile(original)).toEqual(originalBytes);expect(await fs.readFile(picture)).toEqual(png);
  await exportTo(p,path.join(fixture.dir,'Pictures-again.md'));expect(await fs.readFile(path.join(fixture.dir,'Pictures-again.md'))).toEqual(bytes);fixture.recordFile('Pictures-again.md',bytes);
  const draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,exported.label);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1050,850);w.showInactive();});await p.screenshot({path:info.outputPath('local-images-writing.png')});
  await p.locator('#open-confirmed-copy').click();await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');await expect(loaded(p)).toHaveCount(2);
  await stop();p=await launch();await choose(target);await p.locator('#empty-open').click();await expect(loaded(p)).toHaveCount(2);await expect.poll(()=>loaded(p).first().evaluate(n=>n.naturalWidth)).toBe(240);
  await p.locator('#show-drafts').click();await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();await expect(loaded(p)).toHaveCount(2);
  const recovered=await current(p);expect(recovered.source).toBe(exported.source);expect(recovered.confirmedCopy??null).toBeNull();expect(recovered.canUndo).toBe(false);
  await stop();expect(faults).toEqual([]);expect(requests).toEqual([]);passed=true;
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({ok:true,root,exits,originalUnchanged:true,pngSha256:crypto.createHash('sha256').update(png).digest('hex'),exportSha256:exported.confirmedCopy.sha256,attachmentCount:2,readonlyReopen:true,draftRecovery:true,requests,nativeDialogs:'controlled',nativeIME:'NOT VERIFIED'},null,2));
 }finally{await stop();if(fixture)console.log('fixture:'+JSON.stringify(fixture.cleanup({passed,quiescent:!app})));}
});
