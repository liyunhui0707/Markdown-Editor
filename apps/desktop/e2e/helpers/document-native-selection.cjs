const {expect}=require('@playwright/test');
// Drive only the owned synthetic window. Hidden functional runs retain their
// original mode; they are not evidence of native visible-window selection.
async function focusNativeWindow(app,page,hidden=false){
 if(hidden)return;
 await page.bringToFront();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
 await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true);
}
async function settleNativeCaret(node){
 try{
  await expect.poll(()=>node.evaluate(n=>{
   const root=n.closest('.tiptap'),v=root.editor.view,s=getSelection();
   if(v.domObserver.suppressingSelectionUpdates||v.input.mouseDown||!s.rangeCount||!root.contains(s.anchorNode)||!root.contains(s.focusNode))return false;
   return v.state.selection.from===Math.min(v.posAtDOM(s.anchorNode,s.anchorOffset),v.posAtDOM(s.focusNode,s.focusOffset))
    &&v.state.selection.to===Math.max(v.posAtDOM(s.anchorNode,s.anchorOffset),v.posAtDOM(s.focusNode,s.focusOffset));
  })).toBe(true);
 }catch(error){
  console.error('native-selection-fence:'+JSON.stringify(await node.evaluate(n=>{const v=n.closest('.tiptap').editor.view;return {pm:v.state.selection.toJSON(),documentFocus:document.hasFocus(),viewFocus:v.hasFocus(),suppressing:v.domObserver.suppressingSelectionUpdates,mouseDown:!!v.input.mouseDown};}).catch(()=>null)));throw error;
 }
}
module.exports={focusNativeWindow,settleNativeCaret};
