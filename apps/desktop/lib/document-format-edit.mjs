import {mapStructuredEdit} from './document-structured-edit.mjs';
import { mapLinkEdit } from './document-link-edit.mjs';
import { mapBoundaryEdit } from './document-boundary-edit.mjs';
import { projectSource, spanBlock } from './document-source-map.mjs';
const reject = () => ({ok:false,code:'unsafe-format-range'});
const actions = ['paragraph','heading-1','heading-2','heading-3','heading-4','heading-5','heading-6','block-shortcut','fence-shortcut','blockquote','code-block','split-quote','join-quote','exit-block','bold','italic','code','bullet-list','ordered-list','split-list','join-list','split-heading','split-paragraph','join-paragraph'];
const paragraph = content => ({type:'paragraph',content});
const item = content => ({type:'listItem',content:[paragraph(content)]});
const inline = text => text ? [{type:'text',text}] : [];
const splits = (s,n) => /[\uD800-\uDBFF]/.test(s[n-1]||'') && /[\uDC00-\uDFFF]/.test(s[n]||'');
function merge(nodes) {
  const result=[];
  for(const node of nodes.filter(n=>n.text)) {
    const last=result.at(-1);
    if(last && JSON.stringify(last.marks)===JSON.stringify(node.marks)) last.text+=node.text;
    else result.push({...node});
  }
  return result;
}
// Explicit bounded commands. No caller-provided source, source offsets, path or serializer.
export function mapFormatEdit(source, command) {
  if(!command || Object.getPrototypeOf(command)!==Object.prototype) return reject();
  if(['set-link','remove-link'].includes(command.action)) return mapLinkEdit(source,command);
  if(Object.keys(command).length!==3
      || Object.keys(command).some(k=>!['action','from','to'].includes(k))) return reject();
  const {action,from,to}=command;
  if(!actions.includes(action) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from<1 || to<from) return reject();
  const p=projectSource(source);
  if(['split-list','join-list','split-paragraph','join-paragraph'].includes(action)) return mapBoundaryEdit(source,p,command,projectSource);
  const index=p.blocks.findIndex(b=>b && from>b.from && to<b.to);
  if(index<0) return reject();
  const structured=p.blocks[index].quoteRows||p.blocks[index].codeBody;
  if(['blockquote','code-block','split-quote','join-quote','exit-block','fence-shortcut'].includes(action)
      ||(structured&&action==='paragraph')||(action==='block-shortcut'&&/^(?:>|```[A-Za-z0-9_+-]{0,32})$/.test(source.slice(p.blocks[index].sourceFrom,p.blocks[index].sourceTo))))
    return mapStructuredEdit(source,p,command,projectSource);
  const block=p.blocks[index], node=p.doc.content[index], expected=structuredClone(p.doc);
  const list=!!block.items, selected=p.spans.find(s=>s.blockIndex===index && from>=s.from && to<=s.to);
  let a=block.sourceFrom,b=block.sourceTo,text,offset=from-block.from-1, targetIndex=index,targetItem=null,targetQuote=null;
  const nl=source.slice(a,b).match(/\r\n|\n|\r/)?.[0] || source.match(/\r\n|\n|\r/)?.[0] || '\n';
  if(action==='block-shortcut') {
    if(node.type!=='paragraph'||!selected||from!==to||selected.textOffset!==undefined
        ||node.content.length!==1||selected.bold||selected.italic||selected.code||selected.link) return reject();
    const prefix=selected.text.slice(0,from-selected.from), body=selected.text.slice(from-selected.from);
    if(!/^(?:#{1,6}|[-+*]|\d{1,9}[.)])$/.test(prefix)||source.slice(a,b)!==selected.text) return reject();
    a=b=selected.sourceFrom+prefix.length;text=' ';offset=0;
    if(prefix[0]==='#') expected.content[index]={type:'heading',attrs:{level:prefix.length},content:inline(body)};
    else {
      const ordered=/^\d/.test(prefix);
      expected.content[index]={type:ordered?'orderedList':'bulletList',...(ordered?{attrs:{start:parseInt(prefix,10)}}:{}),content:[item(inline(body))]};targetItem=0;
    }
  } else if(['bold','italic','code'].includes(action)) {
    if(!selected || selected.link || from===to || selected.textOffset!==undefined || ['bold','italic','code'].some(mark=>mark!==action&&selected[mark])) return reject();
    const start=from-selected.from,end=to-selected.from,value=selected.text.slice(start,end);
    if(splits(selected.text,start)||splits(selected.text,end)||!value.trim()||value.trim()!==value) return reject();
    const parent=spanBlock({doc:expected},selected), child=selected.inlineIndex??selected.childIndex;
    a=selected.sourceFrom+start;b=selected.sourceFrom+end;
    const marker=action==='bold'?'**':action==='italic'?'*':'`';
    if(selected[action]) {
      if(start!==0||end!==selected.text.length) return reject();
      a-=marker.length;b+=marker.length;text=value; parent.content.splice(child,1,{type:'text',text:value});
    } else {
      text=marker+value+marker;
      parent.content.splice(child,1,...inline(selected.text.slice(0,start)),{type:'text',text:value,marks:[{type:action}]},...inline(selected.text.slice(end)));
    }
    parent.content=merge(parent.content);
    targetItem=selected.itemIndex??null;targetQuote=selected.quoteIndex??null; offset=to-(list?block.items[targetItem].from:targetQuote!==null?block.quoteRows[targetQuote].from:block.from+1);
  } else if(action==='split-heading') {
    if(node.type!=='heading'||!selected||selected.bold||selected.italic||selected.code||selected.link||node.content.length!==1||from!==to) return reject();
    const at=from-selected.from;
    if(at===0||splits(selected.text,at)) return reject();
    a=b=selected.sourceFrom+at;text=nl+nl;
    expected.content[index].content=inline(selected.text.slice(0,at));
    expected.content.splice(index+1,0,paragraph(inline(selected.text.slice(at))));targetIndex=index+1;offset=0;
  } else if(list) {
    if(!['paragraph','bullet-list','ordered-list'].includes(action)) return reject();
    const rows=block.items.map(row=>source.slice(row.bodyFrom,row.sourceTo));
    // Block conversion owns only these markers and their intervening separators.
    if(action==='paragraph'||(action==='bullet-list'&&node.type==='bulletList')||(action==='ordered-list'&&node.type==='orderedList')) {
      text=rows.join(nl+nl);expected.content.splice(index,1,...node.content.map(n=>paragraph(n.content[0].content)));
      targetIndex=index+(selected?.itemIndex??0);offset=selected?from-block.items[selected.itemIndex].from:0;
    } else {
      text=rows.map((s,i)=>(action==='ordered-list'?`${i+1}. `:'- ')+s).join(nl);
      expected.content[index]={type:action==='ordered-list'?'orderedList':'bulletList',...(action==='ordered-list'?{attrs:{start:1}}:{}),content:node.content};
      targetItem=selected?.itemIndex??0;offset=selected?from-block.items[targetItem].from:0;
    }
  } else {
    if(!['paragraph','heading'].includes(node.type)||!selected||selected.textOffset!==undefined) return reject();
    const raw=source.slice(a,b),prefix=node.type==='heading'?raw.match(/^#{1,6}[ \t]+/)?.[0]:'';
    if(prefix===undefined || /[\r\n]/.test(raw)) return reject();
    const body=raw.slice(prefix.length);
    if(body.trim()!==body) return reject();
    if(action==='paragraph') {text=body;expected.content[index]=paragraph(node.content);}
    else if(action.startsWith('heading-')) {text='#'.repeat(Number(action.at(-1)))+' '+body;expected.content[index]={type:'heading',attrs:{level:Number(action.at(-1))},content:node.content};}
    else {
      text=(action==='ordered-list'?'1. ':'- ')+body;
      expected.content[index]={type:action==='ordered-list'?'orderedList':'bulletList',...(action==='ordered-list'?{attrs:{start:1}}:{}),content:[item(node.content)]};targetItem=0;
    }
  }
  if(typeof text!=='string'||text.length>4096||b-a>4096) return reject();
  const next=source.slice(0,a)+text+source.slice(b);
  if(next.length>131072) return reject();
  const projection=projectSource(next);
  if(JSON.stringify(projection.doc)!==JSON.stringify(expected)) return reject();
  const target=projection.blocks[targetIndex];
  if(!target) return reject();
  const position=(targetItem!==null?target.items?.[targetItem]?.from:targetQuote!==null?target.quoteRows?.[targetQuote]?.from:target.from+1)+offset;
  if(!Number.isSafeInteger(position)||position>=target.to) return reject();
  return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},
    inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from:['bold','italic','code'].includes(action)?position-(to-from):position,to:position}};
}
