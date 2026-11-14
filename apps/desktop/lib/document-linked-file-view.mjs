import {linkedFileMessage} from './document-file-presentation.mjs';
export function createLinkedFileView({api,byId,context,busy,rerender,open}){
 const messages=new Map(),unknown=new Set();
 function current(){const c=context(),s=c.controller?.state();return {c,s,file:s?.confirmed.linkedFile,blocked:!s?.confirmed.linkedFile||c.loading||c.invalid||s.locked||s.pending||s.historyPending||s.composing||s.compositionInvalid||s.recoveryRecords.length||s.source!==s.confirmed.source||unknown.has(c.selected)};}
 function render(){
  const {c,s,file,blocked}=current(),panel=byId('linked-file-card');panel.hidden=!s;
  byId('linked-file-path').textContent=file?.filePath||'尚未关联文件';
  const checked=file?.checked;byId('linked-file-status').textContent=messages.get(c.selected)||linkedFileMessage(file,s?.confirmed.originalSave?.stopped);
  byId('linked-file-checked').textContent=checked?`上次检查：${new Date(checked.checkedAt).toLocaleString()}（不是实时监测）`:'';
  for(const id of ['inspect-linked-file','open-linked-file','reveal-linked-file']){byId(id).hidden=!file;byId(id).disabled=!!blocked;}
 }
 for(const id of ['inspect-linked-file','open-linked-file','reveal-linked-file']){
  byId(id).onpointerdown=e=>{if(current().blocked)e.preventDefault();};
  byId(id).onclick=async()=>{
   const {c,s,blocked}=current();if(blocked)return;
   const request={sessionId:c.selected,expectedRevision:s.confirmed.revision};
   if(id==='open-linked-file'){
    const result=await open(request);if(!result?.ok){if(['linked-action-unknown','ipc-outcome-unknown'].includes(result?.code))unknown.add(c.selected);messages.set(c.selected,unknown.has(c.selected)?'打开结果尚未确认，请保留当前文档并检查侧栏；不要重复操作。':result?.code==='session-limit'?'当前窗口已达到八份文档上限，请关闭一份后再打开磁盘版。':'未打开磁盘版。当前文档保留，请检查文件或通过「打开…」重新选择。');rerender();}return;
   }
   messages.delete(c.selected);busy(true);rerender();
   try{
    const result=await api[id==='inspect-linked-file'?'inspectLinkedFile':'revealLinkedFile'](request),now=context();
    if(now.controller!==c.controller||now.selected!==c.selected)return;
    if(result?.code==='linked-action-unknown'||!result||typeof result.ok!=='boolean')throw Error();
    if(id==='inspect-linked-file'){
     if(!result.snapshot||result.snapshot.sessionId!==c.selected||result.snapshot.revision!==request.expectedRevision||result.snapshot.source!==s.confirmed.source)throw Error();
     c.controller.refresh(result);
     if(!result.ok)messages.set(c.selected,'暂时无法检查，当前文档保留。');
    }else messages.set(c.selected,result.ok?'已请求在 Finder 中显示当前磁盘文件。':'文件已移动、不可读取或不是普通文件，未请求 Finder 定位。');
   }catch{unknown.add(c.selected);messages.set(c.selected,'操作结果尚未确认，请保留当前文档，不要重复操作。');}
   finally{busy(false);rerender();}
  };
 }
 return {render,release(id){messages.delete(id);unknown.delete(id);}};
}
