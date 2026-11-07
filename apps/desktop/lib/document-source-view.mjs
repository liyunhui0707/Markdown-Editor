// Read-only originals and explicit source editing of independent drafts.
export function sourceSummary({ source, bom }) {
  const endings = source.match(/\r\n|\r|\n/g) || [];
  const kinds = ['\r\n','\n','\r'].filter(value => endings.includes(value));
  const names = kinds.map(value => ({ '\r\n':'CRLF', '\n':'LF', '\r':'CR' })[value]);
  return `${endings.length + 1} 行 · ${names.join(' / ') || '无换行'} · ${bom ? 'UTF-8 BOM' : '无 BOM'}`;
}
export function createSourceView({byId,context,createEditor}) {
 const button=byId('show-source'),dialog=byId('source-dialog'),text=byId('source-text'),doc=dialog.ownerDocument;
 let enabled=false,snapshot=null,wrapped=true,buffer=null,inFlight=false,stale=false,discarding=false;
 const dirty=()=>buffer&&buffer.source!==snapshot?.source;
 const ready=()=>{
  const {state:s,editor,loading,invalid}=context();
  return enabled&&!!s?.confirmed&&!!editor&&!loading&&!invalid&&!s.locked&&!s.pending&&!s.historyPending
   &&!s.composing&&!s.compositionInvalid&&!s.recoveryRecords?.length&&!editor.view.composing&&s.source===s.confirmed.source;
 };
 function controls() {
  const editing=!!buffer;
  byId('apply-source').hidden=!editing;byId('source-undo').hidden=!editing;byId('source-redo').hidden=!editing;
  byId('apply-source').disabled=!editing||inFlight||stale||buffer.composing;
  byId('source-undo').disabled=!editing||inFlight||buffer.composing||!buffer.canUndo;
  byId('source-redo').disabled=!editing||inFlight||buffer.composing||!buffer.canRedo;
  byId('close-source').disabled=inFlight||!!buffer?.composing;
  byId('source-discard').hidden=!discarding;
  byId('source-note').textContent=editing?'编辑独立草稿的完整 Markdown；应用后进入草稿备份。未应用修改只在此窗口中，原文件不会改写。':'原文只读，可选择并复制。请先创建编辑副本，再修改源码。';
  if(editing)byId('source-metadata').textContent=sourceSummary({source:buffer.source,bom:snapshot.bom})+(dirty()?' · 尚未应用':'');
 }
 function close() {
  if(!dialog.open||inFlight||buffer?.composing)return;
  if(dirty()){discarding=true;controls();return;}
  dialog.close();
 }
 function sync() {
  button.disabled=!ready();
  const current=context().state?.confirmed;
  if(dialog.open&&(!ready()||current?.sessionId!==snapshot?.sessionId||current?.revision!==snapshot.revision||current?.source!==snapshot.source)) {
   if(!buffer)dialog.close();
   else if(!inFlight){stale=true;byId('source-status').textContent='文档状态已变化，源码仍保留在此窗口。请复制需要保留的修改，再关闭并重新打开源码。';}
  }
  if(dialog.open)controls();
 }
 async function apply() {
  if(!buffer||inFlight||stale||buffer.composing||!ready())return;
  const {controller}=context(),expected=snapshot,candidate=buffer.source,caret=buffer.selection;
  if(!controller||controller.state().confirmed.sessionId!==expected.sessionId)return;
  inFlight=true;buffer.setLocked(true);controls();byId('source-status').textContent='正在应用…';
  let ok=false;
  try {ok=await controller.applySource(candidate);}catch { /* Keep the entire buffer on transport or rendering failure. */ }
  inFlight=false;buffer?.setLocked(false);
  if(ok&&context().controller===controller&&controller.state().confirmed.source===candidate) {
   context().restoreSelection?.(caret);dialog.close();
  } else {
   byId('source-status').textContent='修改未确认应用，源码仍保留在此窗口。请勿重复提交未知结果；可以全选复制后检查草稿。';
   sync();
  }
  controls();
 }
 function selectAll() {
  if(!dialog.open)return;
  if(buffer){buffer.selectAll();return;}
  const range=doc.createRange();range.selectNodeContents(text);const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);text.focus({preventScroll:true});
 }
 button.onpointerdown=event=>{if(!ready())event.preventDefault();};
 button.onclick=()=>{
  if(!ready()||doc.querySelector('dialog[open]'))return;
  snapshot={...context().state.confirmed};stale=false;discarding=false;
  byId('source-name').textContent=snapshot.label;byId('source-metadata').textContent=sourceSummary(snapshot);byId('source-status').textContent='';
  const editing=snapshot.temporary===true&&snapshot.readOnly===false&&typeof createEditor==='function';
  text.hidden=editing;byId('source-editor').hidden=!editing;
  text.textContent=editing?'':snapshot.source;
  dialog.showModal();button.setAttribute('aria-expanded','true');
  if(editing) {
   buffer=createEditor({parent:byId('source-editor'),source:snapshot.source,selection:context().sourceSelection?.()||0,
    changed:documentChanged=>{if(buffer){if(documentChanged)discarding=false;controls();}},rejected:()=>{byId('source-status').textContent='本次输入超过当前文本限制或包含无效字符，未应用；之前的内容已保留。';},apply});
   buffer.setWrap(wrapped);buffer.focus();
  } else {text.scrollTop=0;text.scrollLeft=0;text.focus({preventScroll:true});}
  controls();
 };
 byId('close-source').onclick=close;byId('apply-source').onclick=apply;
 byId('apply-source').onpointerdown=event=>{if(buffer?.composing)event.preventDefault();};
 byId('source-undo').onclick=()=>{if(!inFlight&&!buffer?.composing){buffer?.undo();buffer?.focus();}};
 byId('source-redo').onclick=()=>{if(!inFlight&&!buffer?.composing){buffer?.redo();buffer?.focus();}};
 byId('discard-source').onclick=()=>{if(!inFlight&&!buffer?.composing&&discarding)dialog.close();};
 byId('keep-source').onclick=()=>{discarding=false;controls();buffer?.focus();};
 byId('select-source').onclick=selectAll;
 byId('source-wrap').onclick=()=>{wrapped=!wrapped;text.dataset.wrap=String(wrapped);buffer?.setWrap(wrapped);byId('source-wrap').setAttribute('aria-pressed',String(wrapped));};
 text.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='a'){event.preventDefault();selectAll();}});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{
  if(dialog.open)return;
  buffer?.destroy();buffer=null;snapshot=null;stale=false;discarding=false;text.textContent='';byId('source-name').textContent='';byId('source-metadata').textContent='';button.setAttribute('aria-expanded','false');
  if(!button.disabled)button.focus({preventScroll:true});
 });
 return {sync,close,isOpen:()=>dialog.open,configure(){enabled=true;sync();}};
}
