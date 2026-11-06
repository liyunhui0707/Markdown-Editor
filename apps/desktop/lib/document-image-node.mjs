import {Node} from '@tiptap/core';
// Inert card, not an image loader. Source strings are DOM text, never HTML/URLs.
export const DocumentImage=Node.create({name:'documentImage',group:'block',atom:true,selectable:true,draggable:false,
 addAttributes:()=>({alt:{default:''},src:{default:''},title:{default:null}}),
 parseHTML:()=>[{tag:'figure[data-document-image]'}],
 renderHTML:({node})=>['figure',{'data-document-image':'',class:'document-image-reference',contenteditable:'false',role:'img','aria-label':'图片引用：'+(node.attrs.alt||'无说明')},
  ['span',{class:'image-reference-icon','aria-hidden':'true'},'▧'],
  ['span',{class:'image-reference-label'},node.attrs.alt||'图片（无说明）'],
  ['span',{class:'image-reference-target'},node.attrs.src],
  ['small',{},'图片引用 · 未加载预览']],
});
