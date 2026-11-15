import {TextSelection} from '@tiptap/pm/state';
import {mapTextEdit} from './document-source-map.mjs';
// Native Space only; composition and mismatched DOM/PM/browser targets keep
// their existing protection. Dispatch one source-proven transaction/history step.
export function applyBoundarySpace(view,event,{state,blocked=false,report=()=>{}}){
 if(event.inputType!=='insertText'||typeof event.data!=='string'||!/^ +$/.test(event.data)||event.defaultPrevented||!event.cancelable||event.isComposing||event.keyCode===229||view.composing||!view.editable||!view.hasFocus()||!state||blocked||state.confirmed.readOnly||state.locked||state.historyPending||state.composing||state.compositionInvalid||state.recoveryRecords.length)return false;
 const sel=view.state.selection;if(!(sel instanceof TextSelection)||!sel.empty||!(view.state.storedMarks??sel.$from.marks()).some(m=>['bold','italic'].includes(m.type.name)))return false;
 const plan=mapTextEdit(state.source,{from:sel.from,to:sel.to,insert:event.data});if(!plan.ok||!plan.boundarySpace)return false;
 let matched=false;
 try{
  const dom=view.dom.ownerDocument.getSelection();if(!dom||dom.rangeCount!==1||!dom.isCollapsed||!view.dom.contains(dom.anchorNode)||!view.dom.contains(dom.focusNode)||view.posAtDOM(dom.anchorNode,dom.anchorOffset)!==sel.from||view.posAtDOM(dom.focusNode,dom.focusOffset)!==sel.to)return false;
  matched=true;const targets=event.getTargetRanges?.()||[];
  if(targets.length>1||targets.length===1&&(view.posAtDOM(targets[0].startContainer,targets[0].startOffset)!==sel.from||view.posAtDOM(targets[0].endContainer,targets[0].endOffset)!==sel.to))throw Error('target mismatch');
 }catch{if(!matched)return false;event.preventDefault();report('未应用空格：输入范围与当前光标不一致。请重新放置光标，当前文字已保留。',true);return true;}
 event.preventDefault();const schema=view.state.schema,marks=plan.spaceMarks.map(m=>schema.markFromJSON(m));
 const tr=view.state.tr.replaceWith(sel.from,sel.to,schema.text(event.data,marks));tr.setSelection(TextSelection.create(tr.doc,plan.selection.from)).setStoredMarks(marks);
 view.dispatch(tr.scrollIntoView());return true;
}
