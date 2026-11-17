const {expect}=require('@playwright/test');
// Existing content/recovery scenarios export an independent copy. Save As is
// explicit in tests that intend to change the current file's write target.
async function createMarkdownCopy(page,mode='export'){
 const persistent=await page.evaluate(async()=>{const id=document.querySelector('#documents').value;return (await window.documentDemo.snapshot({sessionId:id})).snapshot.persistentCopyEnabled===true;});
 if(persistent){
  await page.locator('#file-actions-toggle').click();
  await page.locator(mode==='save-as'?'#create-test-copy':'#export-copy').click();
  await expect(page.locator('#copy-confirm-dialog')).not.toBeVisible();
 }else{await page.locator('#create-test-copy').click();await page.locator('#confirm-test-copy').click();}
}
// Complete the real Quit lifecycle before Playwright tears down its debugger
// connection. Preserve diagnostic state if the application refuses to exit.
async function closeDocumentApp(app,{page,evidencePath}={}){
 const fs=require('node:fs/promises'),process=app.process();
 const state=async()=>page&&!page.isClosed()?page.evaluate(()=>({status:document.querySelector('#status')?.textContent,workflow:document.querySelector('#workflow-status')?.textContent,viewer:document.querySelector('#viewer-status')?.textContent,modal:document.querySelector('dialog[open]')?.id,options:[...document.querySelector('#documents').options].map(o=>o.value),nativeComposing:document.querySelector('#editor .tiptap')?.editor?.view.composing})).catch(()=>null):null;
 if(evidencePath)await fs.writeFile(evidencePath,JSON.stringify({before:await state()}));
 await app.evaluate(({app})=>{setImmediate(()=>app.quit());}).catch(error=>{if(process.exitCode===null&&process.signalCode===null)throw error;});
 try{await expect.poll(()=>process.exitCode!==null||process.signalCode!==null,{timeout:15000}).toBe(true);}
 catch(error){const diagnostic={after:await state(),exitCode:process.exitCode,signalCode:process.signalCode};console.error('native-quit-diagnostic:'+JSON.stringify(diagnostic));if(evidencePath)await fs.writeFile(evidencePath,JSON.stringify(diagnostic));throw error;}
 await app.close();
}
module.exports={createMarkdownCopy,closeDocumentApp};
