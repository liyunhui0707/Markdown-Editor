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
module.exports={createMarkdownCopy};
