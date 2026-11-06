import { TextSelection } from '@tiptap/pm/state';
import { mapFormatEdit } from './document-format-edit.mjs';

// Synchronous optimistic typing, queued through the same main-owned revision
// and history path as toolbar commands. Never serialize the editor to Markdown.
export function applyBlockShortcut(view, event, context) {
  const {controller,loading,invalid}=context, s=controller?.state();
  if(![' ','Enter'].includes(event.key)||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey
      ||event.isComposing||event.keyCode===229||view.composing||!view.editable
      ||!s||s.confirmed.readOnly||s.composing||s.compositionInvalid||s.locked
      ||s.historyPending||s.recoveryRecords.length||loading||invalid) return false;
  const {from,to,$from,empty}=view.state.selection;
  if(!empty||$from.parent.type.name!=='paragraph') return false;
  const task=$from.depth>1&&$from.node($from.depth-1).type.name==='listItem'&&event.key===' ';
  if(!task&&$from.depth!==1)return false;
  const command={action:task?'task-shortcut':event.key==='Enter'?'fence-shortcut':'block-shortcut',from,to},mapped=mapFormatEdit(s.source,command);
  if(!mapped.ok) return false;
  const doc=view.state.schema.nodeFromJSON(mapped.projection.doc);
  const tr=view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content);
  tr.setSelection(TextSelection.create(tr.doc,mapped.selection.from,mapped.selection.to));
  tr.setStoredMarks(null).setMeta('document-block-shortcut',command);
  event.preventDefault();view.dispatch(tr.scrollIntoView());return true;
}

// Structural typing uses the same optimistic format queue as block shortcuts.
// Inside editable code, Enter/Tab are literal characters, not document structure.
export function applyStructuredKey(view,event,{controller,loading,invalid,report=()=>{}}){
 const s=controller?.state(),selection=view.state.selection,pos=selection.$from;
 if(!s||loading||invalid||!view.editable||s.confirmed.readOnly||s.locked||s.historyPending||s.recoveryRecords.length
   ||s.composing||s.compositionInvalid||view.composing||event.isComposing||event.keyCode===229)return false;
 const code=pos.parent.type.name==='codeBlock'&&pos.parent.attrs.sourceEditable===true;
 const quoted=pos.depth===2&&pos.node(1).type.name==='blockquote';
 const plain=!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey;
 if(code&&plain&&['Enter','Tab'].includes(event.key)&&selection.$from.sameParent(selection.$to)){
  event.preventDefault();view.dispatch(view.state.tr.insertText(event.key==='Enter'?'\n':'\t').scrollIntoView());return true;
 }
 let action;
 if((code||quoted)&&(event.metaKey||event.ctrlKey)&&!event.altKey&&!event.shiftKey&&event.key==='Enter')action='exit-block';
 else if(quoted&&plain&&event.key==='Enter')action='split-quote';
 else if((code||quoted)&&plain&&event.key==='Backspace'&&selection.empty&&pos.parentOffset===0)action=quoted?'join-quote':!pos.parent.content.size?'paragraph':null;
 const inList=pos.depth>1&&pos.node(pos.depth-1).type.name==='listItem';
 if(inList&&event.key==='Tab'&&!event.metaKey&&!event.ctrlKey&&!event.altKey)action=event.shiftKey?'outdent-list':'indent-list';
 if(!code&&!quoted&&plain){
  const inList=Array.from({length:pos.depth},(_,i)=>pos.node(i+1).type.name).some(n=>n==='bulletList'||n==='orderedList');
  if(pos.parent.type.name==='heading'){
   if(event.key==='Enter')action=pos.parent.content.size?'split-heading':'paragraph';
   else if(event.key==='Backspace'&&selection.empty&&pos.parentOffset===0)action='paragraph';
  }else if(inList){
   if(event.key==='Enter')action='split-list';
   else if(event.key==='Backspace'&&selection.empty&&pos.parentOffset===0)action='join-list';
  }else if(pos.depth===1&&pos.parent.type.name==='paragraph'&&selection.empty){
   const marked=n=>n?.type.name==='paragraph'&&n.content.content.some(child=>child.marks.length);
   if(event.key==='Enter'&&marked(pos.parent))action='split-paragraph';
   else if(event.key==='Backspace'&&pos.parentOffset===0){
    const previous=view.state.doc.childBefore(pos.before()).node;
    if(previous&&(marked(pos.parent)||marked(previous)))action='join-paragraph';
   }
  }
 }
 if(!action)return false;
 event.preventDefault();const command={action,from:selection.from,to:selection.to},mapped=mapFormatEdit(s.source,command);
 if(!mapped.ok){report('此处暂不支持该块操作，正文已保留。请收起选区；复杂结构暂不拆分，列表空项退出仅支持首项或末项；引用和代码块可用 ⌘Enter 回到正文。',true);return true;}
 const doc=view.state.schema.nodeFromJSON(mapped.projection.doc),tr=view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content);
 tr.setSelection(TextSelection.create(tr.doc,mapped.selection.from,mapped.selection.to)).setStoredMarks(null).setMeta('document-block-shortcut',command);
 view.dispatch(tr.scrollIntoView());return true;
}

export function applyTaskToggle(view,position,{controller,loading,invalid}) {
 const s=controller?.state();
 if(!s||loading||invalid||!view.editable||s.confirmed.readOnly||s.locked||s.historyPending||s.recoveryRecords.length||s.composing||s.compositionInvalid||view.composing)return false;
 const command={action:'toggle-task',from:position,to:position},mapped=mapFormatEdit(s.source,command);
 if(!mapped.ok)return false;
 const old=view.state.selection,doc=view.state.schema.nodeFromJSON(mapped.projection.doc);
 const tr=view.state.tr.replaceWith(0,view.state.doc.content.size,doc.content);
 tr.setSelection(TextSelection.create(tr.doc,old.from,old.to)).setMeta('document-block-shortcut',command);
 view.dispatch(tr);return true;
}
