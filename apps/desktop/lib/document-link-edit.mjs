import {projectSource,spanBlock} from './document-source-map.mjs';
const reject=code=>({ok:false,code:code||'unsafe-link-range'});
const splits=(s,n)=>/[\uD800-\uDBFF]/.test(s[n-1]||'')&&/[\uDC00-\uDFFF]/.test(s[n]||'');
const textNode=text=>text?[{type:'text',text}]:[];
const plain=s=>!s.codeBlock&&!s.bold&&!s.italic&&!s.code&&!s.link&&s.textOffset===undefined;
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
 const p=projectSource(source),candidates=p.spans.filter(s=>from>=s.from&&to<=s.to);
 const links=candidates.filter(s=>s.link&&s.linkSource);
 const s=links.length===1?links[0]:candidates.length===1&&plain(candidates[0])?candidates[0]:null;
 if(!s||s.textOffset!==undefined||splits(s.text,from-s.from)||splits(s.text,to-s.from))return null;
 return {projection:p,span:s,label:s.link?s.text:s.text.slice(from-s.from,to-s.from),href:s.link?.href||'',existing:!!s.link};
}
export function mapLinkEdit(source,command){
 const setting=command.action==='set-link',keys=setting?['action','from','to','label','href']:['action','from','to'];
 if(!['set-link','remove-link'].includes(command.action)||Object.keys(command).length!==keys.length||Object.keys(command).some(k=>!keys.includes(k)))return reject();
 const c=linkSelection(source,command);if(!c||(!setting&&!c.existing))return reject();
 const {span:s,projection:p}=c,{from,to}=command;
 const label=setting?command.label:s.text;
 if(!validString(label)||!label.trim()||label.length>512)return reject('invalid-link-label');
 if(setting&&!validLinkTarget(command.href))return reject('invalid-link-target');
 const expected=structuredClone(p.doc),parent=spanBlock({doc:expected},s),child=s.inlineIndex??s.childIndex;
 let a,b,insert,selectionFrom;
 const attrs={href:command.href,title:s.link?.title??null};
 if(c.existing){
  const raw=s.linkSource;a=raw.from;b=raw.to;selectionFrom=s.from;
  if(setting){
   const suffix=command.href===s.link.href?source.slice(s.sourceTo,b)
    :source.slice(s.sourceTo,raw.destinationFrom)+'<'+command.href+'>'+source.slice(raw.destinationTo,b);
   insert='['+label+suffix;parent.content.splice(child,1,{type:'text',text:label,marks:[{type:'link',attrs}]});
  }else{insert=label;parent.content.splice(child,1,{type:'text',text:label});}
 }else{
  a=s.sourceFrom+from-s.from;b=s.sourceFrom+to-s.from;selectionFrom=from;
  insert='['+label+'](<'+command.href+'>)';
  parent.content.splice(child,s.text?1:0,...textNode(s.text.slice(0,from-s.from)),{type:'text',text:label,marks:[{type:'link',attrs}]},...textNode(s.text.slice(to-s.from)));
 }
 const merged=[];
 for(const n of parent.content){const last=merged.at(-1);if(last&&JSON.stringify(last.marks)===JSON.stringify(n.marks))last.text+=n.text;else merged.push(n);}
 parent.content=merged;
 if(insert.length>4096||b-a>4096)return reject();
 const next=source.slice(0,a)+insert+source.slice(b);if(next.length>131072)return reject();
 const projection=projectSource(next);if(JSON.stringify(projection.doc)!==JSON.stringify(expected))return reject('unsafe-link-content');
 return {ok:true,source:next,projection,change:{from:a,to:b,insert},inverseSource:{from:a,to:a+insert.length,insert:source.slice(a,b)},selection:{from:selectionFrom,to:selectionFrom+label.length}};
}
