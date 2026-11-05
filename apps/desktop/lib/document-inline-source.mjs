// Bounded edits to one plain/bold paragraph. Existing source tokens are retained;
// only touched text/strong delimiters are patched. This is not a file serializer.
export function mapInlineRange(source, projection, change, project) {
  const {from,to,insert}=change, reject=()=>({ok:false,code:'unsafe-source-range'});
  const index=projection.blocks.findIndex(b=>b && from>b.from && to<b.to);
  if(index<0 || projection.doc.content[index].type!=='paragraph') return null;
  const spans=projection.spans.filter(s=>s.blockIndex===index);
  if(!spans.some(s=>s.bold)||spans.some(s=>s.textOffset!==undefined||s.itemIndex!==undefined)) return null;
  const cut=(s,n)=>n>0 && n<s.length && /[\uD800-\uDBFF]/.test(s[n-1]) && /[\uDC00-\uDFFF]/.test(s[n]);
  const tokens=spans.map(s=>({...s,a:s.sourceFrom-(s.bold?2:0),b:s.sourceTo+(s.bold?2:0),
    marker:s.bold?source.slice(s.sourceFrom-2,s.sourceFrom):''}));
  if(tokens.some((s,i)=>s.bold && (!['**','__'].includes(s.marker)||source.slice(s.sourceTo,s.b)!==s.marker)
      || i && tokens[i-1].b!==s.a)) return reject();
  const touched=from===to ? [tokens.find(s=>s.from<from&&from<=s.to)||tokens[0]]
    : tokens.filter(s=>s.from<to&&s.to>from);
  const first=touched[0],last=touched.at(-1);
  if(!first||from<first.from||to>last.to||cut(first.text,from-first.from)||cut(last.text,to-last.from)) return reject();
  const pieces=[];
  const append=(text,token)=>{
    if(!text)return;
    const previous=pieces.at(-1);
    if(previous && previous.bold===token.bold)previous.text+=text;
    else pieces.push({text,bold:token.bold,marker:token.marker});
  };
  append(first.text.slice(0,from-first.from),first);
  append(insert,first); // PM marksAcross for ranges; marks() uses the left token at an insertion boundary.
  append(last.text.slice(to-last.from),last);
  const replacement=pieces.map(s=>s.bold?s.marker+s.text+s.marker:s.text).join('');
  const original=source.slice(first.a,last.b);
  let start=0,end=original.length,nextEnd=replacement.length;
  while(start<end && start<nextEnd && original[start]===replacement[start])start++;
  if(cut(original,start)||cut(replacement,start))start--;
  while(end>start && nextEnd>start && original[end-1]===replacement[nextEnd-1]){end--;nextEnd--;}
  if(cut(original,end)||cut(replacement,nextEnd)){end++;nextEnd++;}
  const a=first.a+start,b=first.a+end,text=replacement.slice(start,nextEnd);
  if(b-a>4096||text.length>4096)return reject();
  const next=source.slice(0,a)+text+source.slice(b);
  if(next.length>131072)return reject();
  const expected=structuredClone(projection.doc),nodes=[];
  const add=s=>{
    if(!s.text)return;
    const node={type:'text',text:s.text,...(s.bold?{marks:[{type:'bold'}]}:{})},prev=nodes.at(-1);
    if(prev && JSON.stringify(prev.marks)===JSON.stringify(node.marks))prev.text+=node.text;
    else nodes.push(node);
  };
  for(const s of tokens.slice(0,tokens.indexOf(first)))add(s);
  pieces.forEach(add);
  for(const s of tokens.slice(tokens.indexOf(last)+1))add(s);
  expected.content[index].content=nodes;
  const nextProjection=project(next);
  if(JSON.stringify(nextProjection.doc)!==JSON.stringify(expected))return reject();
  return {ok:true,source:next,projection:nextProjection,change:{from:a,to:b,insert:text},
    inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},structural:true,
    selection:{from:from+insert.length,to:from+insert.length}};
}
