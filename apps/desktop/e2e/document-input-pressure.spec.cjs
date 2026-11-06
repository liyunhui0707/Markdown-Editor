const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

test('input queue saturation keeps recovery visible until explicit acknowledgement and resume',async({},info)=>{
  test.setTimeout(90000);
  if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('isolated Electron runtime required');
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-pressure-')));
  const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};
  for(const key of ['TMPDIR','TMP','TEMP'])if(process.env[key])env[key]=process.env[key];
  const app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,
    args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy',
      '--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd:root,env,chromiumSandbox:true});
  const exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));
  const page=await app.firstWindow(),faults=[];page.on('pageerror',e=>faults.push(e.message));
  const status=()=>page.locator('#status').evaluate(n=>JSON.parse(n.textContent));
  const snapshot=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
  const editor=page.locator('#editor .tiptap'),panel=page.locator('#input-pressure-panel');
  try{
    await app.evaluate(({ipcMain,dialog,BrowserWindow})=>{
      dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;
      const original=ipcMain._invokeHandlers.get('document-demo:request');
      globalThis.pressureGate={hold:true,release:null,edits:0};
      ipcMain.removeHandler('document-demo:request');
      ipcMain.handle('document-demo:request',async(e,p)=>{
        const result=await original(e,p);
        if(['edit','format'].includes(p.operation)){
          const g=globalThis.pressureGate;g.edits++;
          if(g.hold){g.hold=false;await new Promise(resolve=>{g.release=resolve;});}
        }
        return result;
      });
      const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,800);w.showInactive();
    });
    await page.locator('#empty-new').click();await expect(editor).toHaveAttribute('contenteditable','true');
    const session=(await status()).activeSessionId;
    await editor.click();await page.keyboard.type('a'.repeat(64));
    await expect.poll(async()=>(await status()).pending).toBe(64);
    await page.keyboard.type('Z');await expect(panel).toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable','false');
    await expect(page.locator('#input-pressure-source')).toHaveText('a'.repeat(64)+'Z');
    await expect(page.locator('#input-pressure-queued')).toHaveText('a'.repeat(64));
    await page.keyboard.type('must not be silently accepted');
    expect((await snapshot()).source).toBe('a'); // Only the first main operation has run.
    await panel.locator('details > summary').first().click();
    await page.locator('#input-pressure-select').click();
    expect(await page.evaluate(()=>getSelection().toString())).toBe('a'.repeat(64)+'Z');
    await page.locator('#input-pressure-ack').check();await expect(page.locator('#input-pressure-resume')).toBeDisabled();
    await app.evaluate(()=>globalThis.pressureGate.release());
    await expect.poll(async()=>(await status()).pending).toBe(0);
    expect((await snapshot()).source).toBe('a'.repeat(64));expect((await snapshot()).revision).toBe(64);
    await expect(panel).toBeVisible();await expect(editor).toHaveAttribute('contenteditable','false');
    await expect(page.locator('#show-source')).toBeDisabled();
    await expect(page.locator('#close-current-document')).toBeDisabled();
    await expect(page.locator('#create-test-copy')).toBeDisabled();
    await expect(page.locator('#backup-summary')).toContainText('输入已暂停');
    await expect(page.locator('#recovery-panel')).toBeHidden();
    await expect(page.locator('#input-pressure-resume')).toBeEnabled();
    await page.locator('#input-pressure-select').click();
    expect(await page.evaluate(()=>getSelection().toString())).toBe('a'.repeat(64)+'Z');
    await page.screenshot({path:info.outputPath('pressure-light.png')});
    // A session switch may not erase the pause or carry acknowledgement to another visit.
    await page.locator('#new-temporary').click();await expect(panel).toBeHidden();
    await page.evaluate(id=>{const n=document.querySelector('#documents');n.value=id;n.dispatchEvent(new Event('change'));},session);
    await expect(panel).toBeVisible();await expect(page.locator('#input-pressure-ack')).not.toBeChecked();
    await expect(page.locator('#input-pressure-resume')).toBeDisabled();
    await page.locator('#show-reading-settings').click();await page.locator('#reading-theme-dark').click();await page.locator('#close-reading-settings').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(780,720));
    expect(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('pressure-dark-narrow.png')});
    await page.locator('#input-pressure-ack').check();await page.locator('#input-pressure-resume').click();
    await expect(panel).toBeHidden();await expect(editor).toHaveAttribute('contenteditable','true');
    expect((await snapshot()).source).toBe('a'.repeat(64));
    await editor.click();await page.keyboard.press('End');await page.keyboard.type('Z');
    await expect.poll(async()=>(await snapshot()).source).toBe('a'.repeat(64)+'Z');
    await page.locator('#format-undo').click();await expect.poll(async()=>(await snapshot()).source).toBe('a'.repeat(64));
    await page.locator('#format-redo').click();await expect.poll(async()=>(await snapshot()).source).toBe('a'.repeat(64)+'Z');
    expect(await app.evaluate(()=>globalThis.pressureGate.edits)).toBe(65);expect(faults).toEqual([]);
    await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({ok:true,root,acceptedBeforePause:64,retainedFirstRefused:'Z',
      automaticRetry:false,explicitAcknowledgement:true,sessionSwitchPreserved:true,history:true,nativeIME:'NOT VERIFIED'},null,2));
  }finally{
    await app.evaluate(()=>globalThis.pressureGate?.release?.());await app.close();expect(await exit).toEqual({code:0,signal:null});
  }
});
