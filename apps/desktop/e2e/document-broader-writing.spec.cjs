const {test, expect, _electron} = require('@playwright/test');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto'), zlib = require('node:zlib');
const {createSaveFolderFixture} = require('../test/helpers/save-folder-fixture.cjs');

function syntheticPNG() {
  const crc = bytes => { let c=0xffffffff; for (const v of bytes) { c^=v; for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^0xffffffff)>>>0; };
  const chunk = (type,data) => { const body=Buffer.concat([Buffer.from(type),data]), b=Buffer.alloc(data.length+12); b.writeUInt32BE(data.length); body.copy(b,4); b.writeUInt32BE(crc(body),b.length-4); return b; };
  const header=Buffer.alloc(13); header.writeUInt32BE(240); header.writeUInt32BE(120,4); header[8]=8; header[9]=2;
  const pixels=Buffer.alloc(120*721); for(let y=0;y<120;y++) for(let x=0;x<240;x++) { const p=y*721+1+x*3; pixels[p]=60+x/3; pixels[p+1]=100+y; pixels[p+2]=130; }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

test('broader writing: image, long navigation, source, export isolation and restart recovery compose', async ({}, info) => {
  test.setTimeout(120000);
  if (!process.env.E2E_ELECTRON_EXECUTABLE) throw Error('isolated Electron runtime required');
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-broader-writing-')));
  const original=path.join(root,'Long image article.md'), picture=path.join(root,'Synthetic.png'), png=syntheticPNG();
  const chapters=Array.from({length:200},(_,i)=>`## Chapter ${String(i+1).padStart(3,'0')} 中文\r\n\r\n${'Synthetic paragraph 中文 🌿. '.repeat(10)}\r\n`).join('\r\n');
  const source='# 合成长文\r\n\r\nOpening paragraph.\r\n\r\n'+chapters+'\r\n<div>Protected synthetic HTML</div>\r\n';
  const originalBytes=Buffer.from('\ufeff'+source), hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  await fs.writeFile(original,originalBytes,{flag:'wx',mode:0o600}); await fs.writeFile(picture,png,{flag:'wx',mode:0o600});
  const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};
  for(const key of ['TMPDIR','TMP','TEMP']) if(process.env[key]) env[key]=process.env[key];
  let app,exit,fixture,passed=false,result; const exits=[],faults=[],requests=[];
  const snap=p=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
  const images=p=>p.locator('#editor img[src]');
  async function launch() {
    const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
    app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),
      '--document-readonly','--document-persistent-copy','--document-drafts-test-root='+path.join(root,'drafts'),
      '--document-recents-test-root='+path.join(root,'recents')],cwd,env,chromiumSandbox:true});
    exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));
    const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
    await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
      dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;
      const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.hide();},original);
    await expect(p.locator('#empty-new')).toBeEnabled();return p;
  }
  async function stop() { if(app) { await app.close();app=null;const r=await exit;exits.push(r);expect(r).toEqual({code:0,signal:null}); } }
  async function backup(p) { await expect.poll(async()=>{const s=await snap(p);return s.draftBackup?.state==='backed-up'&&s.draftBackup.revision===s.revision;}).toBe(true); }
  async function appendOpening(p,text) {
    const paragraph=p.locator('#editor .tiptap > p').first(),before=(await snap(p)).source,previous=await paragraph.textContent();
    await paragraph.click();await p.keyboard.press('End');await p.keyboard.insertText(text);
    await expect.poll(async()=>(await snap(p)).source).toBe(before.replace(previous,previous+text));
  }
  try {
    let p=await launch();await p.locator('#empty-open').click();expect((await snap(p)).source).toBe(source);
    await p.locator('#edit-copy').click();await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','true');
    // insertText supplies controlled Unicode, not a native Chinese IME event stream.
    await appendOpening(p,' 中文 [draft]');const edited=await snap(p);
    expect(edited.source).toBe(source.replace('Opening paragraph.','Opening paragraph. 中文 [draft]'));
    await p.locator('#format-undo').click();await expect.poll(async()=>(await snap(p)).source).toBe(source);
    await p.locator('#format-redo').click();await expect.poll(async()=>(await snap(p)).source).toBe(edited.source);
    await p.locator('#editor .tiptap > p').first().click();await p.locator('#format-image').click();
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},picture);
    await p.locator('#image-choose').click();await expect(p.locator('#image-href')).toHaveValue(/^markdown-image-/);
    await p.locator('#image-label').fill('合成图片');await p.locator('#image-apply').click();
    await expect(images(p)).toHaveCount(1);await expect.poll(()=>images(p).evaluate(n=>n.naturalWidth)).toBe(240);
    const withImage=await snap(p);expect(withImage.source).toContain(chapters);expect(withImage.source).toContain('<div>Protected synthetic HTML</div>');
    await p.locator('#format-undo').click();await expect(images(p)).toHaveCount(0);
    await expect.poll(async()=>(await snap(p)).source).toBe(edited.source);
    await p.locator('#format-redo').click();await expect(images(p)).toHaveCount(1);
    await expect.poll(async()=>(await snap(p)).source).toBe(withImage.source);

    if(await p.locator('#document-outline').isHidden()) await p.locator('#toggle-document-outline').click();
    await p.locator('#outline-filter').fill('chapter 160');await expect(p.locator('#outline-count')).toHaveText('1 / 201');
    await p.locator('#outline-filter').press('Enter');const scroll=await p.locator('#document-scroll').evaluate(n=>n.scrollTop);
    expect(scroll).toBeGreaterThan(10000);const beforeSource=await snap(p);
    await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toBeVisible();
    await expect(p.locator('#source-metadata')).toContainText('CRLF');await expect(p.locator('#source-metadata')).toContainText('UTF-8 BOM');
    await p.locator('#select-source').click();await expect(p.locator('#source-editor .cm-content')).toBeFocused();
    await p.locator('#source-wrap').click();await p.keyboard.press('Escape');
    expect(await p.locator('#document-scroll').evaluate(n=>n.scrollTop)).toBe(scroll);
    const afterSource=await snap(p);expect(afterSource.source).toBe(beforeSource.source);expect(afterSource.revision).toBe(beforeSource.revision);
    await p.locator('#outline-filter').press('Escape');await expect(p.locator('#outline-count')).toHaveText('201');
    await p.locator('#outline-list button').first().click();await backup(p);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await p.screenshot({path:info.outputPath('broader-writing.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
    fixture=createSaveFolderFixture(info.outputDir);const target=path.join(fixture.dir,'Article.md');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},target);
    await p.locator('#create-test-copy').click();await p.locator('#confirm-test-copy').click();
    await expect.poll(async()=>(await snap(p))?.confirmedCopy?.filePath).toBe(target);
    const exported=await snap(p),bytes=await fs.readFile(target);expect(bytes).toEqual(Buffer.from('\ufeff'+withImage.source));
    expect(exported.confirmedCopy.sha256).toBe(hash(bytes));expect(exported.confirmedCopy.attachments).toHaveLength(1);
    const asset=exported.confirmedCopy.attachments[0];expect(await fs.readFile(asset.filePath)).toEqual(png);expect(asset.sha256).toBe(hash(png));
    await p.locator('#open-confirmed-copy').click();await expect(p.locator('#editor .tiptap')).toHaveAttribute('contenteditable','false');
    await expect(images(p)).toHaveCount(1);expect((await snap(p)).source).toBe(withImage.source);
    await p.locator('#edit-copy').click();await appendOpening(p,' 后续未导出');
    const laterSource=withImage.source.replace('Opening paragraph. 中文 [draft]','Opening paragraph. 中文 [draft] 后续未导出');
    await expect.poll(async()=>(await snap(p)).source).toBe(laterSource);await backup(p);
    const later=await snap(p),draftId=await p.evaluate(async label=>(await window.documentDemo.listDrafts()).drafts.find(d=>d.label===label).id,later.label);
    expect(await fs.readFile(target)).toEqual(bytes);expect(await fs.readFile(original)).toEqual(originalBytes);expect(await fs.readFile(picture)).toEqual(png);
    await stop();p=await launch();await p.locator('#show-drafts').click();
    await p.locator(`[data-draft-id="${draftId}"]`).getByRole('button',{name:'恢复副本'}).click();
    await expect(images(p)).toHaveCount(1);await expect.poll(()=>images(p).evaluate(n=>n.naturalWidth)).toBe(240);
    const recovered=await snap(p);expect(recovered.source).toBe(laterSource);expect(recovered.confirmedCopy??null).toBeNull();expect(recovered.canUndo).toBe(false);
    await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toBeVisible();await p.keyboard.press('Escape');
    await appendOpening(p,' 继续写作');await backup(p);
    expect(await fs.readFile(target)).toEqual(bytes);expect(await fs.readFile(original)).toEqual(originalBytes);expect(await fs.readFile(picture)).toEqual(png);
    await stop();expect(faults).toEqual([]);expect(requests).toEqual([]);passed=true;
    result={ok:true,root,headings:201,originalBytes:originalBytes.length,originalUnchanged:true,imageUnchanged:true,
      exportSha256:hash(bytes),attachmentSha256:hash(png),laterEditsIsolated:true,sourceViewPreservedState:true,
      recoveredSourceExact:true,continuedEditingAfterRecovery:true,history:true,exits,requests,nativeDialogs:'controlled',nativeIME:'NOT VERIFIED'};
  } catch(error) {
    if(app){const p=await app.firstWindow();console.log('diagnostic',await p.locator('#status').textContent(),await p.locator('#viewer-status').textContent(),faults);await p.screenshot({path:info.outputPath('failure.png')}).catch(()=>{});}
    throw error;
  } finally {
    await stop();const cleanup=fixture?.archive({quiescent:!app});console.log('fixture:'+JSON.stringify(cleanup??null));
    await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify(result?{...result,cleanup}:{ok:false,root,exits,cleanup},null,2));
    if(passed)expect(cleanup.state).toBe('archived');
  }
});
