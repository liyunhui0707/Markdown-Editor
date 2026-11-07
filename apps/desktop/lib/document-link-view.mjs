import {TextSelection} from '@tiptap/pm/state';
import {linkSelection,validLinkTarget} from './document-link-edit.mjs';

export function createLinkView({byId,context,report}){
 const button=byId('format-link'),dialog=byId('link-dialog'),form=byId('link-form');
 const label=byId('link-label'),href=byId('link-href'),error=byId('link-error'),apply=byId('link-apply'),remove=byId('link-remove');
 let captured=null,busy=false,composing=false;
 const blocked=c=>!c.controller||!c.editor||c.loading||c.invalid||c.state.confirmed.readOnly||c.state.locked
  ||c.state.pending||c.state.historyPending||c.state.composing||c.state.compositionInvalid||c.state.recoveryRecords.length;
 const current=()=>{const c=context();return captured&&c.controller===captured.controller&&c.state.confirmed.revision===captured.revision&&c.state.source===captured.source&&!blocked(c);};
 const message=s=>{error.textContent=s;};
 function open(){
  const c=context();if(blocked(c)||dialog.open)return false;
  const selection={from:c.editor.state.selection.from,to:c.editor.state.selection.to},range=linkSelection(c.state.source,selection);
  if(!range){report('请在普通文字中选择链接文字，或把光标放入一个已有的简单链接。暂不支持跨段落、跨格式或嵌套链接。',true);return false;}
  captured={controller:c.controller,editor:c.editor,revision:c.state.confirmed.revision,source:c.state.source,selection};
  label.value=range.label;href.value=range.href;remove.hidden=!range.existing;message('');
  byId('link-dialog-title').textContent=range.existing?'编辑链接':'插入链接';
  apply.textContent=range.existing?'应用修改':'插入链接';dialog.showModal();(range.label?href:label).focus();sync();return true;
 }
 function close(restore=true){
  if(busy)return;const c=captured,valid=current();dialog.close();captured=null;composing=false;
  if(valid&&c){if(restore)c.editor.view.dispatch(c.editor.state.tr.setSelection(TextSelection.create(c.editor.state.doc,c.selection.from,c.selection.to)));c.editor.view.focus();}
 }
 async function commit(removing=false){
  if(busy)return;
  if(composing){message('请先完成当前输入。');return;}
  if(!current()){message('文档或选区状态已变化。输入仍保留，请取消后重新选择文字。');return;}
  if(!removing&&(!label.value.trim()||label.value.length>512)){message('请输入 1–512 个字符的链接文字。');label.focus();return;}
  if(!removing&&!validLinkTarget(href.value)){message('请输入有效的 http(s)、mailto、相对路径或 #段落地址；地址不能含空格、凭据或脚本协议。');href.focus();return;}
  const c=captured,command={action:removing?'remove-link':'set-link',...c.selection,...(removing?{}:{label:label.value,href:href.value})};
  busy=true;sync();let ok=false;
  try{ok=await c.controller.format(command);}catch{message('操作未确认，输入仍保留。请检查当前文档状态。');}
  finally{busy=false;sync();}
  if(ok&&context().controller===c.controller){dialog.close();captured=null;c.editor.view.focus();report(removing?'已取消链接，文字已保留。':'链接已更新。');}
  else message(['invalid-link-label','unsafe-link-content','unsafe-link-range'].includes(c.controller.state().code)
   ?'此文字或选区暂不支持链接操作。请使用单行普通文字，避免嵌套格式；当前正文未被此操作改写。'
   :'操作未确认。输入仍保留，请检查文档状态后再操作。');
 }
 function sync(){const c=context();button.disabled=blocked(c);button.setAttribute('aria-pressed',String(!!c.editor?.isActive('link')));
  if(dialog.open){apply.disabled=remove.disabled=busy||composing;byId('link-cancel').disabled=busy;label.disabled=href.disabled=busy;}}
 button.onpointerdown=e=>e.preventDefault();button.onclick=open;
 form.addEventListener('submit',e=>{e.preventDefault();void commit();});remove.onclick=()=>void commit(true);
 byId('link-cancel').onclick=()=>close();dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 form.addEventListener('compositionstart',()=>{composing=true;sync();});form.addEventListener('compositionend',()=>{composing=false;sync();});
 return {open,sync,isOpen:()=>dialog.open,key(view,event){
  if((event.metaKey||event.ctrlKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='k'){
   event.preventDefault();if(!event.isComposing&&event.keyCode!==229&&!view.composing)open();return true;
  }return false;
 }};
}
