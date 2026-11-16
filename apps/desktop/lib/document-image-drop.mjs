import {Selection} from '@tiptap/pm/state';
import {imageSelection} from './document-image-edit.mjs';
import capacity from './document-capacity.js';
// Drag bytes have the same main decode/budget fence as clipboard event files.
// No dataTransfer HTML, URL, file path, internal move or default browser drop.
export function dropImage(view,event,{paste,state,blocked,report}){
 event.preventDefault();
 const files=Array.from(event.dataTransfer?.files||[]);
 if(blocked||!state||state.composing||state.locked||state.pending||state.historyPending||state.compositionInvalid||state.recoveryRecords?.length||state.confirmed.readOnly||state.source!==state.confirmed.source||view.composing){report('请先完成当前输入或操作，再拖入图片；正文保留。',true);return true;}
 if(files.length!==1||!['image/png','image/jpeg'].includes(files[0].type)){
  report('每次可拖入一张 PNG/JPEG；文本、链接及其他文件拖放暂不支持。',true);return true;
 }
 if(!files[0].size||files[0].size>capacity.MAX_IMAGE_BYTES){report('图片为空或超过 4 MiB，未导入；正文保留。',true);return true;}
 const hit=view.posAtCoords({left:event.clientX,top:event.clientY});
 if(!hit||!imageSelection(state.source,{from:hit.pos,to:hit.pos})){
  report('请把图片拖到普通段落中；正文保留。',true);return true;
 }
 const selection=Selection.near(view.state.doc.resolve(hit.pos));
 // Never let Selection.near silently jump across a protected structure.
 if(selection.from!==hit.pos||selection.to!==hit.pos){report('此处不能插入图片，正文保留。',true);return true;}
 view.dispatch(view.state.tr.setSelection(selection));
 return paste.paste({preventDefault:()=>{},clipboardData:{files}},'拖入的图片');
}
