import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
import {projectSource} from './document-source-map.mjs';
import {imageNode,validImageLabel,validImageTarget} from './document-image-source.mjs';
const reject=code=>({ok:false,code:code||'unsafe-image-range'});
const empty=()=>({type:'paragraph',content:[]});
export function imageSelection(source,{from,to}){
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from)return null;
 const p=projectSource(source);
 let index=p.blocks.findIndex(b=>b?.image&&from===b.from&&to===b.to);
 if(index>=0)return {p,index,block:p.blocks[index],existing:true};
 index=p.blocks.findIndex((b,i)=>b&&from===to&&from>b.from&&from<b.to&&p.doc.content[i].type==='paragraph'
  &&p.spans.some(s=>s.blockIndex===i&&s.textOffset===undefined&&from>=s.from&&from<=s.to));
 return index<0?null:{p,index,block:p.blocks[index],existing:false};
}
export function mapImageEdit(source,command){
 const setting=command.action==='set-image',keys=setting?['action','from','to','label','href']:['action','from','to'];
 if(!['set-image','remove-image','image-exit'].includes(command.action)||Object.keys(command).length!==keys.length||Object.keys(command).some(k=>!keys.includes(k)))return reject();
 const c=imageSelection(source,command);if(!c||(!setting&&!c.existing))return reject();
 if(setting&&(!validImageLabel(command.label)||!validImageTarget(command.href)))return reject('invalid-image-reference');
 const {p,index,block}=c,expected=structuredClone(p.doc),node=expected.content[index];
 const nl=source.match(/\r\n|\n|\r/)?.[0]||'\n';let a=block.sourceFrom,b=block.sourceTo,text,target=index,prose=false;
 if(setting){
  const attrs=block.image,raw='!['+command.label+(attrs&&attrs.src===command.href?attrs.suffix:'](<'+command.href+'>'+(attrs?.titleSuffix||'')+')');
  const created=imageNode(command.label,command.href,attrs?.title??null);
  text=raw;
  if(c.existing||!node.content.length)expected.content[index]=created;
  else{a=b;text=nl+nl+raw;target++;expected.content.splice(target,0,created);}
 }else if(command.action==='remove-image'){
  text='';prose=true;expected.content[index]=empty();
 }else{
  const next=p.blocks[index+1];
  if(expected.content[index+1]?.type==='paragraph'&&next)return {ok:true,source,projection:p,change:{from:b,to:b,insert:''},inverseSource:{from:b,to:b,insert:''},selection:{from:next.from+1,to:next.from+1}};
  a=b;text=nl+nl;prose=true;target++;expected.content.splice(target,0,empty());
 }
 if(text.length>4096||b-a>4096)return reject();
 const next=source.slice(0,a)+text+source.slice(b);if(next.length>MAX_SOURCE_UNITS)return reject();
 const projection=projectSource(next);if(JSON.stringify(projection.doc)!==JSON.stringify(expected))return reject();
 const chosen=projection.blocks[target];if(!chosen)return reject();
 const from=prose?chosen.from+1:chosen.from,to=prose?from:chosen.to;
 return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from,to}};
}
