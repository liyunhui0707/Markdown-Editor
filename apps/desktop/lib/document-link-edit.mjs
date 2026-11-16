import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
import {projectSource,spanBlock} from './document-source-map.mjs';
import {containerPosition} from './document-container-source.mjs';
import {inlineTextNode} from './document-inline-leaf.mjs';
const reject=code=>({ok:false,code:code||'unsafe-link-range'});
const splits=(s,n)=>/[\uD800-\uDBFF]/.test(s[n-1]||'')&&/[\uDC00-\uDFFF]/.test(s[n]||'');
const eligible=s=>!s.codeBlock&&s.textOffset===undefined;
const sameParent=(a,b)=>a.blockIndex===b.blockIndex&&JSON.stringify(a.containerPath)===JSON.stringify(b.containerPath)&&a.itemIndex===b.itemIndex&&a.quoteIndex===b.quoteIndex&&a.tableRow===b.tableRow&&a.tableCol===b.tableCol;
const validString=s=>typeof s==='string'&&!/[\u0000-\u001f\u007f]/.test(s)
 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
export function validLinkTarget(href){
 if(!validString(href)||!href||href.length>2048||/[\s<>"'\\]/u.test(href)||/%(?:00|0a|0d)/i.test(href))return false;
 if(/^(?:https?|mailto):/i.test(href)){
  try{const u=new URL(href);return !u.username&&!u.password&&(u.protocol==='mailto:'?!!u.pathname.includes('@'):!!u.hostname);}catch{return false;}
 }
 // Local relative references and fragment links remain text; never file access.
 return !href.startsWith('/')&&!href.includes(':');
}
export function linkSelection(source,{from,to}){
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<1||to<from)return null;
 const p=projectSource(source),groups=new Map();
 for(const s of p.spans.filter(s=>eligible(s)&&s.link&&s.linkSource)){
  const key=s.linkSource.from+':'+s.linkSource.to;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);
 }
 const links=[...groups.values()].filter(g=>from>=g[0].from&&to<=g.at(-1).to);
 if(links.length>1)return null;
 let s,group;
 if(links.length===1){group=links[0];s=group[0];if(group.some(n=>!sameParent(s,n)))return null;}
 else{
  const candidates=p.spans.filter(s=>eligible(s)&&!s.link&&from>=s.from&&to<=s.to);
  if(candidates.length!==1)return null;s=candidates[0];group=[s];
  if(s.code&&(from!==s.from||to!==s.to))return null;
 }
 const first=group.find(s=>from>=s.from&&from<=s.to),last=group.find(s=>to>=s.from&&to<=s.to);
 if(!first||!last||splits(first.text,from-first.from)||splits(last.text,to-last.from))return null;
 return {projection:p,span:s,label:s.link?group.map(s=>s.text).join(''):s.text.slice(from-s.from,to-s.from),
  href:s.link?.href||'',existing:!!s.link,formattedLabel:!!s.link&&group.some(s=>s.bold||s.italic||s.code),
  from:s.link?s.from:from,to:s.link?group.at(-1).to:to};
}
// Replace only a PM text interval; hard breaks and all unselected marks survive.
function replaceLabel(parent,start,end,label,link,insertionMarks){
 const out=[];let at=0,inserted=false;
 const marked=n=>{const marks=(n.marks||[]).filter(m=>m.type!=='link');if(link)marks.unshift({type:'link',attrs:link});
  const node={type:'text',text:n.text};if(marks.length)node.marks=marks;return node;};
 for(const n of parent.content){
  const size=n.type==='text'?n.text.length:1,next=at+size;
  if(next<=start||at>=end){
   if(!inserted&&at>=end){if(label!==null)out.push(marked({text:label,marks:insertionMarks}));inserted=true;}
   out.push(n);
  }else{
   if(n.type!=='text')return false;
   const a=Math.max(0,start-at),b=Math.min(size,end-at);
   if(a)out.push({...n,text:n.text.slice(0,a)});
   if(label===null)out.push(marked({...n,text:n.text.slice(a,b)}));
   else if(!inserted){out.push(marked({...n,text:label}));inserted=true;}
   if(b<size)out.push({...n,text:n.text.slice(b)});
  }at=next;
 }
 if(!inserted&&label!==null)out.push(marked({text:label,marks:insertionMarks}));
 const merged=[];for(const n of out){if(n.type==='text'&&!n.text)continue;const last=merged.at(-1);
  if(last?.type==='text'&&n.type==='text'&&JSON.stringify(last.marks)===JSON.stringify(n.marks))last.text+=n.text;else merged.push(n);
 }parent.content=merged;return true;
}
export function mapLinkEdit(source,command){
 const setting=command.action==='set-link',keys=setting?['action','from','to','label','href']:['action','from','to'];
 if(!['set-link','remove-link'].includes(command.action)||Object.keys(command).length!==keys.length||Object.keys(command).some(k=>!keys.includes(k)))return reject();
 const c=linkSelection(source,command);if(!c||(!setting&&!c.existing))return reject();
 const {span:s,projection:p}=c,label=setting?command.label:c.label;
 if(!validString(label)||!label.trim()||label.length>512)return reject('invalid-link-label');
 if(setting&&!validLinkTarget(command.href))return reject('invalid-link-target');
 if(setting&&c.formattedLabel&&label!==c.label)return reject('unsafe-link-label');
 const expected=structuredClone(p.doc),parent=spanBlock({doc:expected},s),block=p.blocks[s.blockIndex];
 const start=s.containerPath?containerPosition(p.doc.content[s.blockIndex],block.from,s.containerPath):s.tableRow!==undefined?block.cells[s.tableRow][s.tableCol].from:s.itemIndex!==undefined?block.items[s.itemIndex].from:s.quoteIndex!==undefined?block.quoteRows[s.quoteIndex].from:block.from+1;
 const attrs=setting?{href:command.href,title:s.link?.title??null}:null;
 let a,b,insert;
 if(c.existing){
  const raw=s.linkSource;a=raw.from;b=raw.to;
  const labelFrom=raw.labelFrom??s.sourceFrom,labelTo=raw.labelTo??s.sourceTo;
  const rawLabel=source.slice(labelFrom,labelTo);
  if(setting){
   const suffix=command.href===s.link.href?source.slice(labelTo,b)
    :source.slice(labelTo,raw.destinationFrom)+'<'+command.href+'>'+source.slice(raw.destinationTo,b);
   insert='['+(c.formattedLabel?rawLabel:label)+suffix;
  }else insert=rawLabel;
 }else{
  a=s.sourceFrom+c.from-s.from;b=s.sourceFrom+c.to-s.from;
  if(s.code){a--;b++;}
  insert='['+(s.code?'`'+label+'`':label)+'](<'+command.href+'>)';
 }
 // Existing formatted labels retain each individual mark run. New links and
 // ordinary labels may change text while keeping the selected leaf's marks.
 if(!replaceLabel(parent,c.from-start,c.to-start,c.formattedLabel||!setting?null:label,attrs,inlineTextNode(s).marks))return reject();
 if(insert.length>4096||b-a>4096)return reject();
 const next=source.slice(0,a)+insert+source.slice(b);if(next.length>MAX_SOURCE_UNITS)return reject();
 const projection=projectSource(next);if(JSON.stringify(projection.doc)!==JSON.stringify(expected))return reject('unsafe-link-content');
 return {ok:true,source:next,projection,change:{from:a,to:b,insert},inverseSource:{from:a,to:a+insert.length,insert:source.slice(a,b)},selection:{from:c.from,to:c.from+label.length}};
}
