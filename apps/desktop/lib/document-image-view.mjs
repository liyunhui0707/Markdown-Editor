import {Selection} from '@tiptap/pm/state';
import {imageSelection} from './document-image-edit.mjs';
import {validImageLabel,validImageTarget} from './document-image-source.mjs';
export function createImageView({api,byId,context,report}){
 const button=byId('format-image'),dialog=byId('image-dialog'),form=byId('image-form');
 const label=byId('image-label'),href=byId('image-href'),error=byId('image-error'),apply=byId('image-apply'),remove=byId('image-remove');
 const choose=byId('image-choose');
 let captured=null,busy=false,composing=false,local=false;
 const blocked=c=>!c.controller||!c.editor||c.loading||c.invalid||c.state.confirmed.readOnly||c.state.locked||c.state.pending
  ||c.state.historyPending||c.state.composing||c.state.compositionInvalid||c.state.recoveryRecords.length||c.editor.view.composing;
 const current=()=>{const c=context();return captured&&c.controller===captured.controller&&c.state.confirmed.revision===captured.revision&&c.state.source===captured.source&&!blocked(c);};
 function open(){
  const c=context();if(blocked(c)||dialog.open)return false;
  const selection={from:c.editor.state.selection.from,to:c.editor.state.selection.to},range=imageSelection(c.state.source,selection);
  if(!range){report('请把光标放在普通段落中插入图片引用，或先选中一张图片引用卡片。',true);return false;}
  captured={controller:c.controller,editor:c.editor,source:c.state.source,revision:c.state.confirmed.revision,selection,json:c.editor.state.selection.toJSON()};
  local=false;label.value=range.block.image?.alt||'';href.value=range.block.image?.src||'';remove.hidden=!range.existing;error.textContent='';
  byId('image-dialog-title').textContent=range.existing?'编辑图片引用':'插入图片引用';apply.textContent=range.existing?'应用修改':'插入引用';
  dialog.showModal();href.focus();sync();return true;
 }
 function close(){if(busy)return;const c=captured,valid=current();dialog.close();captured=null;composing=false;
  if(valid){c.editor.view.dispatch(c.editor.state.tr.setSelection(Selection.fromJSON(c.editor.state.doc,c.json)));c.editor.view.focus();}}
 async function commit(removing=false){
  if(busy)return;if(composing){error.textContent='请先完成当前输入。';return;}
  if(!current()){error.textContent='文档状态已变化，输入仍保留。请取消后重新选择。';return;}
  if(!removing&&(!validImageLabel(label.value)||!validImageTarget(href.value))){error.textContent='请输入相对图片地址或 http(s) 地址。说明限 512 字，不能含方括号、反斜杠或换行；不支持脚本、file 或 data 地址。';return;}
  const c=captured;busy=true;sync();let ok=false;
  try{ok=await c.controller.format({action:removing?'remove-image':'set-image',...c.selection,...(removing?{}:{label:label.value,href:href.value})});}
  catch{error.textContent='操作未确认，请保留当前输入并检查会话状态。';}
  finally{busy=false;sync();}
  if(ok&&context().controller===c.controller){dialog.close();captured=null;c.editor.view.focus();report(removing?'已移除图片引用，可撤销。':(local?'本地图片已插入；请等待草稿备份。按 Enter 继续写作。':'图片引用已更新。按 Enter 继续写作。'));}
  else error.textContent='此操作未确认，正文和面板输入仍保留。请检查选区和文档状态。';
 }
 async function pick(){
  if(busy||composing||!current())return;const c=captured;busy=true;sync();
  try{
   const r=await api.importImage({sessionId:context().state.confirmed.sessionId,expectedRevision:c.revision});
   if(!current()){error.textContent='文档状态已变化，请取消后重新选择。';return;}
   if(r?.ok){href.value=r.href;local=true;error.textContent='图片已读取。点击插入后会随草稿备份，另存时携带附件。';}
   else if(r?.code!=='image-cancelled')error.textContent=`无法使用此图片（${r?.code||'image-import-failed'}）。仅支持每张不超过 4 MiB、4096 像素边长的 PNG/JPEG，每篇最多 16 张（合计 16 MiB / 3200 万像素）。正文未改变。`;
  }catch{error.textContent='图片选择未确认，正文未改变。';}
  finally{busy=false;sync();}
 }
 href.addEventListener('input',()=>{local=false;});
 if(choose)choose.onclick=()=>void pick();
 function sync(){const c=context();button.disabled=!!blocked(c);button.setAttribute('aria-pressed',String(c.editor?.state.selection.node?.type.name==='documentImage'));
  if(dialog.open){if(choose)choose.disabled=busy||composing||!api?.importImage;apply.disabled=remove.disabled=busy||composing;byId('image-cancel').disabled=busy;label.disabled=href.disabled=busy;}}
 button.onpointerdown=e=>e.preventDefault();button.onclick=open;
 form.addEventListener('submit',e=>{e.preventDefault();void commit();});remove.onclick=()=>void commit(true);
 byId('image-cancel').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('keydown',e=>e.stopPropagation());
 form.addEventListener('compositionstart',()=>{composing=true;sync();});form.addEventListener('compositionend',()=>{composing=false;sync();});
 return {open,sync,isOpen:()=>dialog.open,key(view,event){
  if(view.state.selection.node?.type.name!=='documentImage'||!['Enter','Backspace','Delete'].includes(event.key))return false;
  event.preventDefault();const c=context();if(event.isComposing||event.keyCode===229||blocked(c))return true;
  const {from,to}=view.state.selection;void c.controller.format({action:event.key==='Enter'?'image-exit':'remove-image',from,to}).then(ok=>{
   if(context().controller!==c.controller)return;if(!ok)report('此处暂不能移除或退出图片引用，原文已保留。',true);c.editor.view.focus();}).catch(()=>report('操作未确认，当前文字仍保留。请检查会话状态。',true));return true;
 }};
}
