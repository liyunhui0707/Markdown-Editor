import capacity from './document-capacity.js';
// Explicit navigation/insertion around a supported block. Reuse an adjacent
// editable paragraph without recording a content change; main still owns IDs,
// revisions and history. No caller-provided source offsets or serializer.
export function continueInProse(source,p,index,before,project){
 const adjacent=index+(before?-1:1),block=p.blocks[index],next=p.blocks[adjacent];
 if(next&&p.doc.content[adjacent]?.type==='paragraph'&&p.spans.some(s=>s.blockIndex===adjacent)){
  const at=before?next.to-1:next.from+1,from=before?block.sourceFrom:block.sourceTo;
  return {ok:true,source,projection:p,change:{from,to:from,insert:''},inverseSource:{from,to:from,insert:''},selection:{from:at,to:at}};
 }
 const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||source.match(/\r\n|\n|\r/)?.[0]||'\n';
 const from=before?block.sourceFrom:block.sourceTo,insert=nl+nl,nextSource=source.slice(0,from)+insert+source.slice(from);
 if(nextSource.length>capacity.MAX_SOURCE_UNITS)return {ok:false,code:'unsafe-format-range'};
 const expected=structuredClone(p.doc),target=before?index:index+1;expected.content.splice(target,0,{type:'paragraph',content:[]});
 const projection=project(nextSource);
 if(JSON.stringify(expected)!==JSON.stringify(projection.doc))return {ok:false,code:'unsafe-format-range'};
 const at=projection.blocks[target]?.from+1;if(!Number.isSafeInteger(at))return {ok:false,code:'unsafe-format-range'};
 return {ok:true,source:nextSource,projection,change:{from,to:from,insert},inverseSource:{from,to:from+insert.length,insert:''},selection:{from:at,to:at}};
}
