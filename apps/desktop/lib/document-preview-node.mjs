import {Node} from '@tiptap/core';
import {previewDOMSpec} from './document-semantic-preview.mjs';

export const DocumentPreview=Node.create({
 name:'documentPreview',group:'block',atom:true,selectable:true,draggable:false,
 addAttributes(){return {kind:{default:'paragraph',rendered:false},tree:{default:null,rendered:false}};},
 renderHTML({node}){return ['section',{'data-document-preview':'',class:'document-preview',contenteditable:'false',
  role:'group','aria-readonly':'true','aria-label':'Markdown 预览；通过源码编辑'},previewDOMSpec(node.attrs.tree)];},
});
