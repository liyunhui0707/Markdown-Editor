const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');

test('long article: filtered outline, readonly exact source and return to writing preserve state', async ({}, info) => {
  test.setTimeout(120000);
  if (!process.env.E2E_ELECTRON_EXECUTABLE) throw Error('isolated Electron runtime required');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-long-source-')));
  const original = path.join(root, 'Long article.md');
  const body = Array.from({length:200}, (_,i) => `## Chapter ${String(i+1).padStart(3,'0')} 中文\r\n\r\n${'Synthetic long article, 中文与 emoji 🌿. '.repeat(12)}\r\n`).join('\r\n');
  const source = '# 合成长文章\r\n\r\n'+body+'\r\n<div data-private="synthetic">Not interpreted <script>window.sourceExecuted=true</script></div>\r\n\r\n```md\r\n# Not a heading\r\n```\r\n';
  const bytes = Buffer.from('\ufeff'+source);
  await fs.writeFile(original, bytes, {flag:'wx',mode:0o600});
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-')));
  const env = {PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8'};
  for (const key of ['TMPDIR','TMP','TEMP']) if (process.env[key]) env[key]=process.env[key];
  const app = await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,
    args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy',
      '--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents')],cwd,env,chromiumSandbox:true});
  const exit = new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));
  const page = await app.firstWindow(), faults = [], requests = [];
  page.on('pageerror',e=>faults.push(e.message)); page.on('request',r=>{if (/^https?:/.test(r.url())) requests.push(r.url());});
  const snapshot = () => page.evaluate(async()=> (await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
  const metrics = {};
  try {
    await app.evaluate(({dialog,BrowserWindow},file)=>{
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
      dialog.showMessageBox=async()=>({response:1}); dialog.showMessageBoxSync=()=>1;
      const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1440,900);w.showInactive();
    },original);
    await expect(page.locator('#empty-open')).toBeEnabled();
    const start=Date.now(); await page.locator('#empty-open').click();
    await expect(page.locator('#outline-list button')).toHaveCount(201); metrics.openMs=Date.now()-start;
    if (await page.locator('#document-outline').isHidden()) await page.locator('#toggle-document-outline').click();
    const before = await snapshot(); expect(before.source).toBe(source); expect(before.bom).toBe(true);
    await page.locator('#outline-filter').fill('chapter 160'); await expect(page.locator('#outline-count')).toHaveText('1 / 201');
    await page.locator('#outline-filter').press('Enter');
    const scrollBefore=await page.locator('#document-scroll').evaluate(n=>n.scrollTop); expect(scrollBefore).toBeGreaterThan(10000);
    await page.locator('#show-source').click(); await expect(page.locator('#source-dialog')).toBeVisible();
    expect(await page.locator('#source-text').textContent()).toBe(source);
    await expect(page.locator('#source-metadata')).toContainText('CRLF');
    await expect(page.locator('#source-metadata')).toContainText('UTF-8 BOM');
    expect(await page.evaluate(()=>window.sourceExecuted)).toBeUndefined();
    await page.keyboard.type('attempted edit'); expect(await page.locator('#source-text').textContent()).toBe(source);
    await page.keyboard.press('Meta+a');
    expect(await page.evaluate(()=>getSelection().toString())).toContain('Not interpreted <script>');
    await page.locator('#select-source').click();
    expect(await page.evaluate(()=>getSelection().toString())).toContain('Not interpreted <script>');
    await page.locator('#source-wrap').click(); await expect(page.locator('#source-text')).toHaveCSS('white-space','pre');
    await page.screenshot({path:info.outputPath('source-light.png')});
    await page.keyboard.press('Escape'); await expect(page.locator('#source-dialog')).toBeHidden();
    expect(await page.locator('#document-scroll').evaluate(n=>n.scrollTop)).toBe(scrollBefore);
    expect(await snapshot()).toEqual(before);
    await page.locator('#outline-filter').fill('');
    await page.locator('#outline-list button').first().click();
    await page.evaluate(()=>{
      window.headingReads=0;const original=Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect=function(){if (/^H[1-6]$/.test(this.tagName))window.headingReads++;return original.call(this);};
      document.querySelector('#document-scroll').scrollTop=30000;
    });
    await expect.poll(()=>page.locator('#outline-list [aria-current=location]').textContent()).not.toBe('合成长文章');
    metrics.headingReads=await page.evaluate(()=>window.headingReads); expect(metrics.headingReads).toBeLessThan(40);
    await page.locator('#edit-copy').click(); await expect(page.locator('#editor .tiptap')).toHaveAttribute('contenteditable','true');
    await page.locator('#editor h1').click(); await page.keyboard.press('Home'); await page.keyboard.type('X');
    await expect(page.locator('#source')).toContainText('X');
    const edited=await snapshot(); const editStart=Date.now();
    await page.locator('#show-source').click(); await expect(page.locator('#source-editor .cm-content')).toBeVisible();
    metrics.sourceOpenMs=Date.now()-editStart;
    await page.keyboard.press('Escape'); await page.locator('#format-undo').click();
    await expect.poll(async()=> (await snapshot()).source).toBe(source);
    await page.locator('#format-redo').click(); await expect.poll(async()=> (await snapshot()).source).toBe(edited.source);
    await page.locator('#show-reading-settings').click(); await page.locator('#reading-theme-dark').click(); await page.locator('#close-reading-settings').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(780,720));
    expect(await page.locator('#writing-toolbar').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
    await page.locator('#show-source').click();
    expect(await page.locator('#source-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth && n.scrollHeight<=n.clientHeight)).toBe(true);
    await page.screenshot({path:info.outputPath('source-dark-narrow.png')}); await page.keyboard.press('Escape');
    await page.locator('#new-temporary').click(); await expect(page.locator('#outline-list button')).toHaveCount(0);
    await page.locator('#show-source').click(); expect(await page.locator('#source-text').textContent()).toBe('');
    await page.keyboard.press('Escape');
    await page.locator('#editor .tiptap').dispatchEvent('compositionstart',{data:''});
    await expect(page.locator('#show-source')).toBeDisabled();
    await page.evaluate(()=>document.querySelector('#show-source').onclick()); await expect(page.locator('#source-dialog')).toBeHidden();
    await page.locator('#editor .tiptap').dispatchEvent('compositionend',{data:''});
    await expect(page.locator('#show-source')).toBeEnabled();
    expect(await fs.readFile(original)).toEqual(bytes); expect(faults).toEqual([]); expect(requests).toEqual([]);
    await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({ok:true,root,bytes:bytes.length,headings:201,metrics,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'),originalUnchanged:true,sourceReadonly:true,
      dialogs:'controlled',nativeIME:'NOT VERIFIED'},null,2));
  } catch (error) { console.log('diagnostic', await page.locator('#status').textContent(), await page.locator('#viewer-status').textContent(), faults); throw error; } finally { await app.close(); expect(await exit).toEqual({code:0,signal:null}); }
});
