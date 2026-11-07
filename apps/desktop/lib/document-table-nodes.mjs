import {Node} from '@tiptap/core';
// Schema/rendering only: source-verified commands own all table mutations.
const Table=Node.create({name:'table',group:'block',content:'tableRow+',isolating:true,
  parseHTML:()=>[{tag:'table'}],renderHTML:()=>['table',{'data-document-table':''},['tbody',0]]});
const Row=Node.create({name:'tableRow',content:'(tableCell | tableHeader)+',
  parseHTML:()=>[{tag:'tr'}],renderHTML:()=>['tr',0]});
const cell=(name,tag)=>Node.create({name,content:'paragraph',isolating:true,
  addAttributes:()=>({align:{default:null,parseHTML:el=>el.getAttribute('data-align'),renderHTML:a=>a.align?{'data-align':a.align}:{}}}),
  parseHTML:()=>[{tag}],renderHTML:({HTMLAttributes})=>[tag,HTMLAttributes,0]});
export const documentTableNodes=[Table,Row,cell('tableHeader','th'),cell('tableCell','td')];
