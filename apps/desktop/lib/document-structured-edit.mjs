const reject=()=>({ok:false,code:'unsafe-format-range'});
const inline=text=>text?[{type:'text',text}]:[];
const paragraph=content=>({type:'paragraph',content});
const quote=content=>({type:'blockquote',content});
const cuts=(s,n)=>/[\uD800-\uDBFF]/.test(s[n-1]||'')&&/[\uDC00-\uDFFF]/.test(s[n]||'');
// Structural commands patch only the selected source block. The full projected
// document must match the intended result; exact inverse bytes remain in main.
export function mapStructuredEdit(source,p,{action,from,to},project){
 const index=p.blocks.findIndex(b=>b&&from>b.from&&to<b.to);if(index<0)return reject();
 const block=p.blocks[index],node=p.doc.content[index],expected=structuredClone(p.doc);
 const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||source.match(/\r\n|\n|\r/)?.[0]||'\n';
 let a=block.sourceFrom,b=block.sourceTo,text,targetIndex=index,targetRow=null,offset=0;
 const rowIndex=block.quoteRows?.findIndex(r=>from>=r.from&&to<=r.to),row=block.quoteRows?.[rowIndex];
 if(action==='blockquote'||action==='code-block'||action==='block-shortcut'||action==='fence-shortcut'){
  if(!['paragraph','heading'].includes(node.type)||block.items)return reject();
  const spans=p.spans.filter(s=>s.blockIndex===index),raw=source.slice(a,b),plain=node.content.every(n=>!n.marks?.length);
  if(spans.some(s=>s.textOffset!==undefined)||/[\r\n]/.test(raw))return reject();
  const body=node.type==='heading'?raw.replace(/^#{1,6} /,''):raw;
  if(action==='blockquote'){
   text='> '+body;expected.content[index]=quote([paragraph(node.content)]);targetRow=0;offset=from-block.from-1;
  }else if(action==='code-block'){
   if(!plain)return reject();text='```'+nl+body+nl+'```';expected.content[index]={type:'codeBlock',attrs:{language:null,sourceEditable:true},content:inline(body)};offset=from-block.from-1;
  }else{
   if(from!==to||node.type!=='paragraph'||!plain||from!==block.to-1)return reject();
   if(action==='block-shortcut'&&raw==='>'){text='> ';expected.content[index]=quote([paragraph([])]);targetRow=0;}
   else {const m=raw.match(/^```([A-Za-z0-9_+-]{0,32})$/);if(!m)return reject();text=raw+nl+'```';expected.content[index]={type:'codeBlock',attrs:{language:m[1]||null,sourceEditable:true},content:[]};}
  }
 }else if(action==='paragraph'){
  if(block.quoteRows){
   if(!row)return reject();text=block.quoteRows.map(r=>source.slice(r.bodyFrom,r.sourceTo)).join(nl+nl);
   expected.content.splice(index,1,...node.content);targetIndex+=rowIndex;offset=from-row.from;
  }else if(block.codeBody){
   const value=node.content[0]?.text||'';if(value.includes('\n'))return reject();text=value;expected.content[index]=paragraph(inline(value));offset=from-block.from-1;
  }else return reject();
 }else if(action==='exit-block'){
  if(from!==to||(!block.quoteRows&&!block.codeBody))return reject();
  a=b; text=nl+nl;expected.content.splice(index+1,0,paragraph([]));targetIndex++;
 }else if(['split-quote','join-quote'].includes(action)){
  if(!row||from!==to)return reject();
  const spans=p.spans.filter(s=>s.blockIndex===index&&s.quoteIndex===rowIndex),current=node.content[rowIndex],value=current.content.map(n=>n.text).join('');
  // Inline-mark boundary splitting is deliberately not guessed.
  if(spans.length!==1||current.content.some(n=>n.marks?.length))return reject();
  const at=from-row.from;if(cuts(value,at))return reject();
  if(action==='split-quote'&&!value){
   if(rowIndex!==node.content.length-1)return reject();
   if(rowIndex===0){text='';expected.content[index]=paragraph([]);}
   else {a=block.quoteRows[rowIndex-1].sourceTo;text=nl+nl;expected.content[index].content.pop();expected.content.splice(index+1,0,paragraph([]));targetIndex++;}
  }else if(action==='split-quote'){
   a=b=row.bodyFrom+at;text=nl+'> '+nl+'> ';
   expected.content[index].content.splice(rowIndex,1,paragraph(inline(value.slice(0,at))),paragraph(inline(value.slice(at))));targetRow=rowIndex+1;
  }else if(at===0){
   if(rowIndex===0){
    // Unwrap only the first paragraph; the following quote keeps its markers.
    b=block.quoteRows[1]?.sourceFrom??block.sourceTo;text=value+(node.content.length>1?nl+nl:'');
    expected.content.splice(index,1,paragraph(current.content),...(node.content.length>1?[quote(node.content.slice(1))]:[]));
   }else{
    const prev=block.quoteRows[rowIndex-1],prevNode=node.content[rowIndex-1];if(prevNode.content.some(n=>n.marks?.length))return reject();
    const before=prevNode.content.map(n=>n.text).join('');a=prev.sourceTo;b=row.bodyFrom;text='';
    expected.content[index].content.splice(rowIndex-1,2,paragraph(inline(before+value)));targetRow=rowIndex-1;offset=before.length;
   }
  }else return reject();
 }else return reject();
 if(typeof text!=='string')return reject();
 // Trim equal edges before applying the existing bounded-edit limit.
 const old=source.slice(a,b);let left=0,right=old.length,end=text.length;
 while(left<right&&left<end&&old[left]===text[left])left++;
 if(cuts(old,left)||cuts(text,left))left--;
 while(right>left&&end>left&&old[right-1]===text[end-1]){right--;end--;}
 if(cuts(old,right)||cuts(text,end)){right++;end++;}
 b=a+right;a+=left;text=text.slice(left,end);
 if(text.length>4096||b-a>4096)return reject();
 const next=source.slice(0,a)+text+source.slice(b);if(next.length>131072)return reject();
 const projection=project(next);if(JSON.stringify(expected)!==JSON.stringify(projection.doc))return reject();
 const target=projection.blocks[targetIndex],pos=(targetRow===null?target?.from+1:target?.quoteRows?.[targetRow]?.from)+offset;
 if(!Number.isSafeInteger(pos)||pos>=target.to)return reject();
 return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from:pos,to:pos}};
}
