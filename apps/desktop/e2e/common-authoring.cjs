const { expect } = require('@playwright/test');

// One shared user workflow for source and the real packaged application. All
// changes go through the editor UI; only selection/clipboard events are controlled.
async function authorMixedDocument(page, source, { append = false, newline = '\n' } = {}) {
  if (append) {
    const tail=page.locator('#editor .tiptap > p').last();
    await tail.evaluate(p=>{const root=p.closest('.tiptap');root.focus();getSelection().collapse(p,p.childNodes.length);document.dispatchEvent(new Event('selectionchange'));});
    await page.keyboard.press('End');await page.keyboard.press('Enter');
    await expect.poll(source).toMatch(/(?:\r\n|\n|\r){2}$/);
  } else await page.locator('#editor .tiptap > p').click();
  const original=await source(),nl=newline;
  // The packaged fixture has an existing terminal newline. Enter inserts a new
  // empty paragraph before it; preserve that suffix in every exact-byte check.
  const suffix=append?nl:'';
  if(append)expect(original.endsWith(nl.repeat(3))).toBe(true);
  const prefix=original.slice(0,original.length-suffix.length);
  const check=async body=>{await expect.poll(source).toBe(prefix+body+suffix);};
  const range=async(selector,from,to=from)=>{
    const positions=await page.locator(selector).last().evaluate((p,r)=>{
      const root=p.closest('.tiptap');root.focus();const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n,offset=0,a,b;
      while(n=walker.nextNode()){if(!a&&r.from<=offset+n.length)a=[n,r.from-offset];if(!b&&r.to<=offset+n.length)b=[n,r.to-offset];offset+=n.length;}
      if(!a||!b)throw Error('Missing synthetic range');getSelection().setBaseAndExtent(b[0],b[1],a[0],a[1]);document.dispatchEvent(new Event('selectionchange'));
      return[root.editor.view.posAtDOM(a[0],a[1]),root.editor.view.posAtDOM(b[0],b[1])];
    },{from,to});
    await expect.poll(()=>page.locator('#editor .tiptap').evaluate(n=>[n.editor.state.selection.from,n.editor.state.selection.to])).toEqual(positions);
  };
  await page.keyboard.type('# Field notes');await check('# Field notes');
  await page.keyboard.press('Enter');await page.keyboard.type('A steady paragraph for words.');
  let body='# Field notes'+nl+nl+'A steady paragraph for words.';await check(body);
  const paragraph='#editor .tiptap > p:last-child';
  await range(paragraph,2,8);await page.locator('#format-bold').click();body=body.replace('steady','**steady**');await check(body);
  await range(paragraph,9,18);await page.locator('#format-italic').click();body=body.replace('paragraph','*paragraph*');await check(body);
  await range(paragraph,23,28);await page.locator('#format-code').click();body=body.replace('words','`words`');await check(body);
  await range(paragraph,0,1);await page.keyboard.press('Meta+k');await page.locator('#link-href').fill('https://example.test/guide');await page.locator('#link-apply').click();
  body=body.replace('A **steady**','[A](<https://example.test/guide>) **steady**');await check(body);
  await range(paragraph+' [data-document-link]',0);await page.keyboard.press('Meta+k');await page.locator('#link-href').fill('../guide.md#notes');await page.locator('#link-apply').click();
  body=body.replace('https://example.test/guide','../guide.md#notes');await check(body);
  await range(paragraph,29);await page.keyboard.type(' More words.');body+=' More words.';await check(body);
  await range(paragraph,41);await page.keyboard.press('Enter');await page.keyboard.type('- First item');await page.keyboard.press('Enter');await page.keyboard.type('Second item');
  body+=nl+nl+'- First item'+nl+'- Second item';await check(body);
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('> Quoted words');await page.keyboard.press('Enter');await page.keyboard.insertText('引用第二段');
  body+=nl+nl+'> Quoted words'+nl+'> '+nl+'> 引用第二段';await check(body);
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('```js');await page.keyboard.press('Enter');await page.keyboard.type('const path = "[safe]";');await page.keyboard.press('Enter');await page.keyboard.press('Tab');await page.keyboard.type('// note');
  body+=nl+nl+'```js'+nl+'const path = "[safe]";'+nl+'\t// note'+nl+'```';await check(body);
  await page.locator('#editor .tiptap').evaluate(root=>{const data=new DataTransfer();data.setData('text/plain','\n\nreturn path;');root.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  body=body.replace('// note'+nl+'```','// note'+nl+nl+'return path;'+nl+'```');await check(body);
  await page.keyboard.press('Meta+Enter');await page.keyboard.insertText('Closing note.');body+=nl+nl+'Closing note.';await check(body);
  await page.keyboard.press('Meta+z');await check(body.slice(0,-13));await page.keyboard.press('Meta+Shift+z');await check(body);
  const confirmed=await source();await page.keyboard.press('Meta+f');await page.locator('#find-query').fill('Quoted words');await expect(page.locator('#find-count')).toHaveText('1 / 1');await page.keyboard.press('Escape');expect(await source()).toBe(confirmed);
  await expect(page.locator('#editor h1').last()).toHaveText('Field notes');await expect(page.locator('#editor blockquote p')).toHaveCount(2);
  await expect(page.locator('#editor pre code')).toHaveText('const path = "[safe]";\n\t// note\n\nreturn path;');
  await expect(page.locator('#editor a')).toHaveCount(0);
  return confirmed;
}
module.exports={authorMixedDocument};
