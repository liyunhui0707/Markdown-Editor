// Bounded edits to one plain/bold/italic paragraph or adjacent projected simple-list items.
// Existing source tokens are retained;
// only touched text/emphasis delimiters are patched. This is not a file serializer.
export function mapInlineRange(source, projection, change, project) {
  const {from,to,insert}=change, reject=()=>({ok:false,code:'unsafe-source-range'});
  const index=projection.blocks.findIndex(b=>b && from>b.from && to<b.to);
  if(index<0) return null;
  const block=projection.blocks[index],list=!!block.items;
  const quoteRow=block.quoteRows?.findIndex(r=>from>=r.from&&to<=r.to);
  const quoted=quoteRow!==undefined&&quoteRow>=0;
  if(!list&&!quoted&&projection.doc.content[index].type!=='paragraph')return null;
  const itemIndex=list?block.items.findIndex(row=>from>=row.from&&from<=row.to):undefined;
  const endItem=list?block.items.findIndex(row=>to>=row.from&&to<=row.to):undefined;
  if(list && (itemIndex<0||endItem<itemIndex))return reject();
  const cross=list&&endItem>itemIndex;
  const spans=projection.spans.filter(s=>s.blockIndex===index&&(list?s.itemIndex>=itemIndex&&s.itemIndex<=endItem:quoted?s.quoteIndex===quoteRow:s.itemIndex===undefined));
  // V1 edits one link label at a time. Never reconstruct its destination.
  if(spans.some(s=>s.link))return reject();
  if((!list&&!spans.some(s=>s.bold||s.italic||s.code))||spans.some(s=>s.textOffset!==undefined)) return null;
  const cut=(s,n)=>n>0 && n<s.length && /[\uD800-\uDBFF]/.test(s[n-1]) && /[\uDC00-\uDFFF]/.test(s[n]);
  const tokens=spans.map(s=>({...s,a:s.sourceFrom-(s.bold?2:s.italic||s.code?1:0),b:s.sourceTo+(s.bold?2:s.italic||s.code?1:0),
    marker:s.bold||s.italic||s.code?source.slice(s.sourceFrom-(s.bold?2:1),s.sourceFrom):''}));
  if(tokens.some((s,i)=>(s.bold||s.italic||s.code) && (!(s.bold?['**','__']:s.code?['`']:['*','_']).includes(s.marker)||source.slice(s.sourceTo,s.b)!==s.marker)
      || i && tokens[i-1].itemIndex===s.itemIndex && tokens[i-1].b!==s.a)) return reject();
  // Removing item boundaries must not discard unprojected margins or syntax.
  if(cross && block.items.slice(itemIndex,endItem+1).some((row,i)=>{
    const part=tokens.filter(s=>s.itemIndex===itemIndex+i);
    return !part.length||part[0].a!==row.bodyFrom||part.at(-1).b!==row.sourceTo;
  }))return reject();
  const left=cross?tokens.filter(s=>s.itemIndex===itemIndex):null,right=cross?tokens.filter(s=>s.itemIndex===endItem):null;
  const touched=cross?[left.find(s=>from>=s.from&&from<s.to)||left.at(-1),right.find(s=>to>s.from&&to<=s.to)||right[0]]
    : from===to ? [tokens.find(s=>s.from<from&&from<=s.to)||tokens[0]]
    : tokens.filter(s=>s.from<to&&s.to>from);
  const first=touched[0],last=touched.at(-1);
  if(!first||from<first.from||to>last.to||cut(first.text,from-first.from)||cut(last.text,to-last.from)) return reject();
  const pieces=[];
  const append=(text,token)=>{
    if(!text)return;
    const previous=pieces.at(-1);
    if(previous && previous.bold===token.bold && !!previous.italic===!!token.italic && !!previous.code===!!token.code)previous.text+=text;
    else pieces.push({text,bold:token.bold,italic:token.italic,code:token.code,marker:token.marker});
  };
  append(first.text.slice(0,from-first.from),first);
  // marksAcross has no start marks at the end of a textblock, unlike collapsed typing.
  append(insert,cross&&from===block.items[itemIndex].to?{bold:false,marker:''}:first);
  append(last.text.slice(to-last.from),last);
  const replacement=pieces.map(s=>s.marker+s.text+s.marker).join('');
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
    const node={type:'text',text:s.text,...(s.bold||s.italic||s.code?{marks:[{type:s.bold?'bold':s.italic?'italic':'code'}]}:{})},prev=nodes.at(-1);
    if(prev && JSON.stringify(prev.marks)===JSON.stringify(node.marks))prev.text+=node.text;
    else nodes.push(node);
  };
  for(const s of tokens.slice(0,tokens.indexOf(first)))add(s);
  pieces.forEach(add);
  for(const s of tokens.slice(tokens.indexOf(last)+1))add(s);
  const target=list?expected.content[index].content[itemIndex].content[0]:quoted?expected.content[index].content[quoteRow]:expected.content[index];
  target.content=nodes;
  if(cross)expected.content[index].content.splice(itemIndex+1,endItem-itemIndex);
  const nextProjection=project(next);
  if(JSON.stringify(nextProjection.doc)!==JSON.stringify(expected))return reject();
  return {ok:true,source:next,projection:nextProjection,change:{from:a,to:b,insert:text},
    inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},structural:true,
    selection:{from:from+insert.length,to:from+insert.length}};
}
