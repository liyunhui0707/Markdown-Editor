'use strict';
// A native close is completed only after the normal per-document close path has
// revoked every session. The renderer cannot supply a discard flag or file path.
function installWindowClose({win,ipcMain,manager,confirmUnavailable=()=>false}){
 let approved=false,requested=false;
 win.on('close',event=>{
  if(approved)return;
  event.preventDefault();manager.flushDrafts();
  if(manager.isWindowRevoked?.(win)){
   if(confirmUnavailable()){approved=true;win.close();}return;
  }
  if(!requested){requested=true;win.webContents.send('document-demo:window-close-request');}
  // A cancelled or blocked renderer attempt can be requested again by the user.
  setTimeout(()=>{requested=false;},250);
 });
 ipcMain.handle('document-demo:finish-window-close',(event,...args)=>{
  if(args.length||!manager.canFinishWindowClose(event))return {ok:false,code:'documents-still-open'};
  approved=true;win.close();return {ok:true};
 });
}
module.exports={installWindowClose};
