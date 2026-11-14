import capacity from './document-capacity.js';
import {inlineFrames,renderInlineParts,inlineNodes} from './document-inline-tree.mjs';
import {listNodeAt} from './document-list-source.mjs';
const reject=()=>({ok:false,code:'unsafe-source-range'});
const cut=(s,n)=>n>0&&n<s.length&&/[\uD800-\uDBFF]/.test(s[n-1])&&/[\uDC00-\uDFFF]/.test(s[n]);
export const inlineTarget=(doc,s)=>s.itemIndex!==undefined?listNodeAt(doc.content[s.blockIndex],s.itemPath??[s.itemIndex]).content[0]:s.quoteIndex!==undefined?doc.content[s.blockIndex].content[s.quoteIndex]:doc.content[s.blockIndex];
export function patchInlineParts(source,p,spans,pieces,selection){
 const frames=spans.map(s=>inlineFrames(s,source));
 const a=frames[0][0]?.from??spans[0].sourceFrom,b=frames.at(-1)[0]?.to??spans.at(-1).sourceTo;
 const old=source.slice(a,b);if(renderInlineParts(spans,source)!==old)return reject();
 const raw=renderInlineParts(pieces,source);let start=0,end=old.length,nextEnd=raw.length;
 while(start<end&&start<nextEnd&&old[start]===raw[start])start++;
 if(cut(old,start)||cut(raw,start))start--;
 while(end>start&&nextEnd>start&&old[end-1]===raw[nextEnd-1]){end--;nextEnd--;}
 if(cut(old,end)||cut(raw,nextEnd)){end++;nextEnd++;}
 const from=a+start,to=a+end,insert=raw.slice(start,nextEnd),next=source.slice(0,from)+insert+source.slice(to);
 if(to-from>4096||insert.length>4096||next.length>capacity.MAX_SOURCE_UNITS)return reject();
 const expected=structuredClone(p.doc);inlineTarget(expected,spans[0]).content=inlineNodes(pieces);
 return {ok:true,source:next,expected,change:{from,to,insert},inverseSource:{from,to:from+insert.length,insert:source.slice(from,to)},structural:true,selection};
}
export function planTreeRange(source,p,{from,to,insert},spans){
 if(!spans.some(s=>s.frames))return null;
 const touched=from===to?[spans.find(s=>s.from<from&&from<=s.to)||spans[0]]:spans.filter(s=>s.from<to&&s.to>from);
 const first=touched[0],last=touched.at(-1);
 if(!first||from<first.from||to>last.to||cut(first.text,from-first.from)||cut(last.text,to-last.from))return reject();
 const pieces=[...spans.slice(0,spans.indexOf(first)),{...first,text:first.text.slice(0,from-first.from)+insert},
  {...last,text:last.text.slice(to-last.from)},...spans.slice(spans.indexOf(last)+1)];
 return patchInlineParts(source,p,spans,pieces,{from:from+insert.length,to:from+insert.length});
}
export function mapCombinedMark(source,p,{action,from,to},project){
 if(!['bold','italic'].includes(action))return null;
 const s=p.spans.find(s=>from>=s.from&&to<=s.to);
 if(!s||s.code||s.link||s.textOffset!==undefined||(!s.frames&&!(action==='bold'?s.italic:s.bold)))return null;
 if(from===to||cut(s.text,from-s.from)||cut(s.text,to-s.from))return {ok:false,code:'unsafe-format-range'};
 const value=s.text.slice(from-s.from,to-s.from);if(value.trim()!==value||!value)return {ok:false,code:'unsafe-format-range'};
 const spans=p.spans.filter(n=>n.blockIndex===s.blockIndex&&n.itemIndex===s.itemIndex&&n.quoteIndex===s.quoteIndex);
 const frames=inlineFrames(s,source),marker=action==='bold'?'**':s.bold?'_':'*';
 const selected={...s,text:value,[action]:!s[action],frames:s[action]?frames.filter(f=>f.kind!==action):[...frames,{kind:action,from:-1,to:-1,open:marker,close:marker}]};
 const i=spans.indexOf(s),pieces=[...spans.slice(0,i),{...s,text:s.text.slice(0,from-s.from)},selected,{...s,text:s.text.slice(to-s.from)},...spans.slice(i+1)];
 const plan=patchInlineParts(source,p,spans,pieces,{from,to});
 if(!plan.ok)return plan;const {expected,...result}=plan,projection=project(plan.source);
 return JSON.stringify(expected)===JSON.stringify(projection.doc)?{...result,projection}:{ok:false,code:'unsafe-format-range'};
}
