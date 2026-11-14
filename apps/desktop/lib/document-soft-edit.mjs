import capacity from './document-capacity.js';
// Soft source newlines display as spaces. Only explicit cross-line edits remove
// them; untouched line-ending bytes and a main-owned exact inverse are retained.
export function planSoftRange(source,p,{from,to,insert}){
 const split=insert==='\n\n'&&from===to;
 if(!split&&(/[\0\r\n]/.test(insert)||!insert.isWellFormed()))return null;
 const i=p.blocks.findIndex(b=>b&&from>b.from&&to<b.to),spans=p.spans.filter(s=>s.blockIndex===i&&s.textOffset!==undefined);
 if(!spans.length)return null;
 const left=spans.find(s=>from>=s.from&&from<=s.to),right=spans.find(s=>to>=s.from&&to<=s.to);
 if(!left||!right||(!split&&left===right))return null;
 const cut=(s,n)=>n>0&&n<s.length&&/[\uD800-\uDBFF]/.test(s[n-1])&&/[\uDC00-\uDFFF]/.test(s[n]);
 const a=left.sourceFrom+from-left.from,b=right.sourceFrom+to-right.from,reject=()=>({ok:false,code:'unsafe-source-range'});
 if(cut(left.text,from-left.from)||cut(right.text,to-right.from))return reject();
 const nl=source.slice(p.blocks[i].sourceFrom,p.blocks[i].sourceTo).match(/\r\n|\n|\r/)?.[0]||'\n';
 const text=split?nl+nl:insert,next=source.slice(0,a)+text+source.slice(b);
 if(b-a>4096||text.length>4096||next.length>capacity.MAX_SOURCE_UNITS)return reject();
 const expected=structuredClone(p.doc),raw=expected.content[i].content[0].text,at=from-p.blocks[i].from-1,end=to-p.blocks[i].from-1;
 const paragraph=value=>({type:'paragraph',content:value?[{type:'text',text:value}]:[]});
 if(split)expected.content.splice(i,1,paragraph(raw.slice(0,at)),paragraph(raw.slice(at)));
 else expected.content[i]=paragraph(raw.slice(0,at)+insert+raw.slice(end));
 return {ok:true,source:next,expected,change:{from:a,to:b,insert:text},inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},structural:true,selection:{from:from+insert.length,to:from+insert.length}};
}
export function mapSoftRange(source,p,change,project){
 const plan=planSoftRange(source,p,change);if(!plan?.ok)return plan;
 const {expected,...result}=plan,projection=project(plan.source);
 return JSON.stringify(expected)===JSON.stringify(projection.doc)?{...result,projection}:{ok:false,code:'unsafe-source-range'};
}
