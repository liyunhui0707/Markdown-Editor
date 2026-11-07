const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

test('keyboard workspace: named content, roving tools, modal focus and contrast preserve source',async({},info)=>{
 test.setTimeout(90000);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-a11y-')));
 const original=path.join(root,'Keyboard article.md'),source='# Heading\n\nOrdinary paragraph.\n\n## Next heading\n\nMore text.\n';
 await fs.writeFile(original,source,{flag:'wx',mode:0o600});
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()};
 const app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,
  args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy',
   '--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),
   '--document-original-saves-test-root='+path.join(root,'versions')],cwd:root,env,chromiumSandbox:true});
 const exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal}))),faults=[],requests=[];
 const p=await app.firstWindow();p.on('pageerror',e=>faults.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 const evidence={root,nativeIME:'NOT VERIFIED',voiceOver:'NOT VERIFIED',passed:false};
 const snap=()=>p.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const idle=()=>expect.poll(()=>p.locator('#status').textContent().then(JSON.parse).then(s=>s.pending===0&&!s.historyPending&&!s.composing)).toBe(true);
 try{
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBoxSync=()=>1;
   BrowserWindow.getAllWindows()[0].setContentSize(1280,850);},original);
  await expect(p.locator('#empty-open')).toBeEnabled();await p.locator('#empty-open').click();
  const editor=p.locator('#editor .tiptap');
  await expect(editor).toHaveAttribute('role','document');await expect(editor).toHaveAccessibleName('只读正文：Keyboard article.md');
  await expect(p.locator('#session-filter')).toHaveAccessibleName('筛选已打开文档');
  await p.locator('#show-reading-settings').focus();await p.keyboard.press('F6');await expect(editor).toBeFocused();
  await p.locator('#edit-copy').click();await idle();await expect(editor).toHaveAttribute('role','textbox');
  await expect(editor).toHaveAttribute('aria-multiline','true');await expect(editor).toHaveAttribute('aria-readonly','false');
  const before=await snap();
  await editor.focus();await p.keyboard.press('F6');await expect(p.locator('#outline-filter')).toBeFocused();
  await p.keyboard.press('F6');await expect(p.locator('#session-filter')).toBeFocused();
  await p.keyboard.press('Shift+F6');await expect(p.locator('#outline-filter')).toBeFocused();
  await p.keyboard.press('Shift+F6');await expect(editor).toBeFocused();
  await p.keyboard.press('Alt+F10');
  const tools=p.locator('#format-inline-tools');await expect(tools.locator('button[tabindex="0"]')).toHaveCount(1);
  const available=await tools.locator('button:enabled').evaluateAll(ns=>ns.map(n=>n.id));
  await expect(p.locator('#'+available[0])).toBeFocused();await p.keyboard.press('End');await expect(p.locator('#'+available.at(-1))).toBeFocused();
  await p.keyboard.press('ArrowRight');await expect(p.locator('#'+available[0])).toBeFocused();
  await p.keyboard.press('Tab');await expect(p.locator('#reading-tools button[tabindex="0"]')).toBeFocused();
  await p.locator('#format-block').focus();await p.keyboard.press('Tab');await expect(p.locator('#'+available[0])).toBeFocused();
  expect((await snap()).source).toBe(before.source);expect((await snap()).revision).toBe(before.revision);
  // Native dialog focus confinement and restoration, without clicking the page.
  await p.locator('#show-reading-settings').focus();await p.keyboard.press('Enter');
  await expect(p.locator('#close-reading-settings')).toBeFocused();await p.keyboard.press('Shift+Tab');
  await expect(p.locator('#reset-reading-settings')).toBeFocused();await p.keyboard.press('Tab');await expect(p.locator('#close-reading-settings')).toBeFocused();
  await p.keyboard.press('F6');await expect(p.locator('#close-reading-settings')).toBeFocused();
  await p.keyboard.press('Escape');await expect(p.locator('#show-reading-settings')).toBeFocused();
  // Actual rendered palette, rather than assertions about particular CSS strings.
  evidence.contrast=[];
  for(const theme of ['light','dark']){
   await p.locator('#show-reading-settings').click();await p.locator('#reading-theme-'+theme).click();await p.keyboard.press('Escape');
   const ratios=await p.evaluate(()=>{
    const c=getComputedStyle(document.body),rgb=h=>{h=h.trim().slice(1);if(h.length===3)h=[...h].map(x=>x+x).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);};
    const lum=h=>rgb(h).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{const x=lum(c.getPropertyValue(a)),y=lum(c.getPropertyValue(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    return {mutedPaper:ratio('--muted','--paper'),mutedPanel:ratio('--muted','--panel'),mutedActive:ratio('--muted','--active'),accentPaper:ratio('--accent','--paper')};
   });evidence.contrast.push({theme,...ratios});for(const value of Object.values(ratios))expect(value).toBeGreaterThanOrEqual(4.5);
  }
  // Narrow sidebar can be entered, then dismissed without reaching behind it.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(700,800));
  await expect.poll(()=>p.evaluate(()=>innerWidth)).toBe(700);await expect(p.locator('#toggle-session-sidebar')).toHaveAttribute('aria-expanded','false');
  await p.locator('#toggle-session-sidebar').focus();await p.keyboard.press('Enter');await expect(p.locator('#session-filter')).toBeFocused();
  await p.keyboard.press('Escape');await expect(p.locator('#toggle-session-sidebar')).toBeFocused();
  await expect(p.locator('#toggle-session-sidebar')).toHaveAttribute('aria-expanded','false');
  // Activate a formatting command by keyboard, then undo through the real controller.
  // Prepare an exact browser selection; platform line-navigation shortcuts are not this test's subject.
  await p.locator('#editor p').first().evaluate(n=>{n.closest('.tiptap').focus();const r=document.createRange();r.selectNodeContents(n);
   const selection=getSelection();selection.removeAllRanges();selection.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  await expect.poll(()=>editor.evaluate(n=>{const {doc,selection}=n.editor.state;return doc.textBetween(selection.from,selection.to);})).toBe('Ordinary paragraph.');
  await expect(p.locator('#format-bold')).toBeEnabled();await p.keyboard.press('Alt+F10');await p.keyboard.press('Home');await expect(p.locator('#format-bold')).toBeFocused();await p.keyboard.press('Enter');await idle();
  expect((await snap()).source).toContain('**Ordinary paragraph.**');
  await p.keyboard.press('Meta+z');await idle();expect((await snap()).source).toBe(before.source);
  // Composition owns focus; navigation must not force-confirm or discard preedit.
  await p.locator('#editor p').first().click();await p.keyboard.press('End');const cdp=await p.context().newCDPSession(p);
  await cdp.send('Input.imeSetComposition',{text:'ceshi',selectionStart:5,selectionEnd:5});
  await expect(p.locator('#status')).toContainText('"composing":true');await p.keyboard.press('F6');await expect(editor).toBeFocused();
  expect((await snap()).source).toBe(before.source);await cdp.send('Input.insertText',{text:'测试'});await idle();
  expect((await snap()).source).toContain('测试');await p.keyboard.press('Meta+z');await idle();expect((await snap()).source).toBe(before.source);
  await p.locator('#show-source').click();await expect(p.locator('#source-editor .cm-content')).toHaveAccessibleName('Markdown 源码编辑');
  await p.keyboard.press('Escape');await expect(p.locator('#show-source')).toBeFocused();
  expect(await fs.readFile(original,'utf8')).toBe(source);expect(faults).toEqual([]);expect(requests).toEqual([]);
  await p.screenshot({path:info.outputPath('keyboard-workspace.png')});evidence.passed=true;
 }finally{evidence.focus=await p.evaluate(()=>({active:document.activeElement?.id||document.activeElement?.className,
   dialog:document.querySelector('dialog[open]')?.id||null,windowFocused:document.hasFocus(),selectionLength:getSelection()?.toString().length})).catch(()=>null);
  console.log('accessibility-evidence:'+JSON.stringify(evidence));await app.close();evidence.exit=await exit;expect(evidence.exit).toEqual({code:0,signal:null});
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({...evidence,faults,requests,artifacts:'OS temporary synthetic files only; no Home fixtures'},null,2));}
});
