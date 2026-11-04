import { projectSource, spanBlock } from './document-source-map.mjs';
const reject = () => ({ok:false,code:'unsafe-format-range'});
const actions = ['paragraph','heading-1','heading-2','heading-3','bold','bullet-list','ordered-list','split-list','join-list','split-heading'];
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
  if(!command || Object.getPrototypeOf(command)!==Object.prototype || Object.keys(command).length!==3
      || Object.keys(command).some(k=>!['action','from','to'].includes(k))) return reject();
  const {action,from,to}=command;
  if(!actions.includes(action) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from<1 || to<from) return reject();
  const p=projectSource(source), index=p.blocks.findIndex(b=>b && from>b.from && to<b.to);
  if(index<0) return reject();
  const block=p.blocks[index], node=p.doc.content[index], expected=structuredClone(p.doc);
  const list=!!block.items, selected=p.spans.find(s=>s.blockIndex===index && from>=s.from && to<=s.to);
  let a=block.sourceFrom,b=block.sourceTo,text,offset=from-block.from-1, targetIndex=index,targetItem=null;
  const nl=source.slice(a,b).match(/\r\n|\n|\r/)?.[0] || source.match(/\r\n|\n|\r/)?.[0] || '\n';
  if(action==='bold') {
    if(!selected || from===to || selected.textOffset!==undefined) return reject();
    const start=from-selected.from,end=to-selected.from,value=selected.text.slice(start,end);
    if(splits(selected.text,start)||splits(selected.text,end)||!value.trim()||value.trim()!==value) return reject();
    const parent=spanBlock({doc:expected},selected), child=selected.inlineIndex??selected.childIndex;
    a=selected.sourceFrom+start;b=selected.sourceFrom+end;
    if(selected.bold) {
      if(start!==0||end!==selected.text.length) return reject();
      a-=2;b+=2;text=value; parent.content.splice(child,1,{type:'text',text:value});
    } else {
      text='**'+value+'**';
      parent.content.splice(child,1,...inline(selected.text.slice(0,start)),{type:'text',text:value,marks:[{type:'bold'}]},...inline(selected.text.slice(end)));
    }
    parent.content=merge(parent.content);
    targetItem=selected.itemIndex??null; offset=to-(list?block.items[targetItem].from:block.from+1);
  } else if(action==='split-heading') {
    if(node.type!=='heading'||!selected||selected.bold||node.content.length!==1||from!==to) return reject();
    const at=from-selected.from;
    if(at===0||splits(selected.text,at)) return reject();
    a=b=selected.sourceFrom+at;text=nl+nl;
    expected.content[index].content=inline(selected.text.slice(0,at));
    expected.content.splice(index+1,0,paragraph(inline(selected.text.slice(at))));targetIndex=index+1;offset=0;
  } else if(action==='split-list'||action==='join-list') {
    if(!list||!selected||from!==to||selected.bold) return reject();
    const i=selected.itemIndex,row=block.items[i],textNode=node.content[i].content[0];
    if(textNode.content.length>1 || splits(selected.text,from-selected.from)) return reject();
    const at=from-selected.from,items=expected.content[index].content;
    if(action==='split-list') {
      if(!selected.text) {
        // Exit only the last empty item. Earlier items and all following source remain intact.
        if(i!==items.length-1) return reject();
        a=i ? block.items[i-1].sourceTo : block.sourceFrom;b=row.sourceTo;text=i?nl+nl:'';
        if(i) { items.pop(); expected.content.splice(index+1,0,paragraph([]));targetIndex=index+1; }
        else expected.content.splice(index,1,paragraph([]));
        offset=0;
      } else {
        a=b=selected.sourceFrom+at;
        const marker=node.type==='orderedList'?`${Math.min(999999999,node.attrs.start+i+1)}${row.marker.trim().at(-1)} `:row.marker;
        text=nl+marker; items.splice(i,1,item(inline(selected.text.slice(0,at))),item(inline(selected.text.slice(at))));
        targetItem=i+1;offset=0;
      }
    } else {
      if(i===0||at!==0) return reject();
      const previous=node.content[i-1].content[0];
      if(previous.content.some(n=>n.marks?.length)) return reject();
      const left=previous.content.map(n=>n.text).join('');
      a=block.items[i-1].sourceTo;b=row.bodyFrom;text='';
      items.splice(i-1,2,item(inline(left+selected.text)));targetItem=i-1;offset=left.length;
    }
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
    if(!body || body.trim()!==body) return reject();
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
  const position=(targetItem===null?target.from+1:target.items?.[targetItem]?.from)+offset;
  if(!Number.isSafeInteger(position)||position>=target.to) return reject();
  return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},
    inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from:action==='bold'?position-(to-from):position,to:position}};
}
