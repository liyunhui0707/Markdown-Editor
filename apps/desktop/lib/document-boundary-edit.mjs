const reject = () => ({ok:false,code:'unsafe-format-range'});
const paragraph = content => ({type:'paragraph',content});
const item = content => ({type:'listItem',content:[paragraph(content)]});
const cutsPair = (s,n) => /[\uD800-\uDBFF]/.test(s[n-1]||'') && /[\uDC00-\uDFFF]/.test(s[n]||'');
const mark = marker => marker==='`'?'code':marker.length===2?'bold':marker?'italic':null;
const render = pieces => pieces.map(p=>p.marker+p.text+p.marker).join('');
function merge(pieces) {
  const result=[];
  for(const p of pieces.filter(p=>p.text)) {
    if(result.length && mark(result.at(-1).marker)===mark(p.marker)) result.at(-1).text+=p.text;
    else result.push({...p});
  }
  return result;
}
const content = pieces => merge(pieces).map(p=>({type:'text',text:p.text,...(p.marker?{marks:[{type:mark(p.marker)}]}:{})}));
function split(pieces,at) {
  const left=[],right=[];
  for(const p of pieces) {
    const n=Math.max(0,Math.min(at,p.text.length));
    if(n)left.push({...p,text:p.text.slice(0,n)});
    if(n<p.text.length)right.push({...p,text:p.text.slice(n)});
    at-=p.text.length;
  }
  return [left,right];
}

// Bounded source commands over existing projected paragraphs/flat list items.
// No caller-supplied source patch; inverse bytes remain owned by main history.
export function mapBoundaryEdit(source,p,{action,from,to},project) {
  if(from!==to)return reject();
  const index=p.blocks.findIndex(b=>b&&from>b.from&&from<b.to);
  if(index<0)return reject();
  const block=p.blocks[index],node=p.doc.content[index],expected=structuredClone(p.doc);
  const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0] || source.match(/\r\n|\n|\r/)?.[0] || '\n';
  function body(i,rowIndex=null) {
    const b=p.blocks[i],n=p.doc.content[i];
    if(!b || (rowIndex===null && n.type!=='paragraph'))return null;
    const row=rowIndex===null?null:b.items?.[rowIndex];
    if(rowIndex!==null&&!row)return null;
    const spans=p.spans.filter(s=>s.blockIndex===i&&(rowIndex===null?s.itemIndex===undefined:s.itemIndex===rowIndex));
    if(!spans.length||spans.some(s=>s.textOffset!==undefined||s.link))return null;
    const pieces=spans.map(s=>({text:s.text,marker:s.bold||s.italic||s.code?source.slice(s.sourceFrom-(s.bold?2:1),s.sourceFrom):''}));
    const a=row?row.bodyFrom:b.sourceFrom,end=row?row.sourceTo:b.sourceTo;
    if(pieces.some(s=>s.marker&&!['**','__','*','_','`'].includes(s.marker))||render(pieces)!==source.slice(a,end))return null;
    return {pieces,text:pieces.map(s=>s.text).join(''),a,b:end,from:row?row.from:b.from+1};
  }
  let a,b,text,targetIndex=index,targetItem=null,offset=0;
  if(action==='split-paragraph'||action==='join-paragraph') {
    const current=body(index);if(!current)return reject();
    const at=from-current.from;if(cutsPair(current.text,at))return reject();
    if(action==='split-paragraph') {
      if(!current.text)return reject();
      const [left,right]=split(current.pieces,at);
      a=current.a;b=current.b;text=render(left)+nl+nl+render(right);
      expected.content.splice(index,1,paragraph(content(left)),paragraph(content(right)));targetIndex++;
    } else {
      const previous=body(index-1);
      if(at!==0||!previous||(!previous.text&&!current.text)||source.slice(previous.b,current.a)!==nl+nl)return reject();
      const pieces=merge([...previous.pieces,...current.pieces]);
      a=previous.a;b=current.b;text=render(pieces);
      expected.content.splice(index-1,2,paragraph(content(pieces)));targetIndex--;offset=previous.text.length;
    }
  } else {
    if(!block.items)return reject();
    const rows=block.items,i=rows.findIndex(r=>from>=r.from&&from<=r.to),current=body(index,i);
    if(!current)return reject();
    const at=from-current.from;if(cutsPair(current.text,at))return reject();
    const items=expected.content[index].content;
    const remainder=start=>({...structuredClone(node),
      ...(node.type==='orderedList'?{attrs:{start:parseInt(rows[start].marker,10)}}:{}),content:items.slice(start)});
    if(action==='split-list' && !current.text) {
      // Same-kind lists separated by only a blank paragraph parse as one loose
      // list. Refuse that middle-item exit rather than invent hidden Markdown.
      if(i!==0&&i!==rows.length-1)return reject();
      if(i===0) {
        a=block.sourceFrom;b=rows[1]?.sourceFrom??block.sourceTo;text=rows.length>1?nl+nl:'';
        expected.content.splice(index,1,paragraph([]),...(rows.length>1?[remainder(1)]:[]));
      } else {
        a=rows[i-1].sourceTo;b=current.b;text=nl+nl;
        items.pop();expected.content.splice(index+1,0,paragraph([]));targetIndex++;
      }
    } else if(action==='split-list') {
      const [left,right]=split(current.pieces,at),row=rows[i];
      const marker=node.type==='orderedList'?`${Math.min(999999999,node.attrs.start+i+1)}${row.marker.trim().at(-1)} `:row.marker;
      a=current.a;b=current.b;text=render(left)+nl+marker+render(right);
      items.splice(i,1,item(content(left)),item(content(right)));targetItem=i+1;
    } else if(action==='join-list' && at===0) {
      if(i===0) {
        a=block.sourceFrom;b=rows[1]?.sourceFrom??block.sourceTo;
        text=render(current.pieces)+(rows.length>1?nl+nl:'');
        expected.content.splice(index,1,paragraph(content(current.pieces)),...(rows.length>1?[remainder(1)]:[]));
      } else {
        const previous=body(index,i-1);if(!previous)return reject();
        const pieces=merge([...previous.pieces,...current.pieces]);
        a=previous.a;b=current.b;text=render(pieces);
        items.splice(i-1,2,item(content(pieces)));targetItem=i-1;offset=previous.text.length;
      }
    } else return reject();
  }
  // Limit the actual patch, preserving exact common source bytes around it.
  const old=source.slice(a,b);let start=0,end=old.length,nextEnd=text.length;
  while(start<end&&start<nextEnd&&old[start]===text[start])start++;
  if(cutsPair(old,start)||cutsPair(text,start))start--;
  while(end>start&&nextEnd>start&&old[end-1]===text[nextEnd-1]){end--;nextEnd--;}
  if(cutsPair(old,end)||cutsPair(text,nextEnd)){end++;nextEnd++;}
  b=a+end;a+=start;text=text.slice(start,nextEnd);
  if(text.length>4096||b-a>4096)return reject();
  const next=source.slice(0,a)+text+source.slice(b);if(next.length>131072)return reject();
  const projection=project(next);if(JSON.stringify(projection.doc)!==JSON.stringify(expected))return reject();
  const target=projection.blocks[targetIndex];
  const position=(targetItem===null?target?.from+1:target?.items?.[targetItem]?.from)+offset;
  if(!Number.isSafeInteger(position)||position>=target.to)return reject();
  return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},
    inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from:position,to:position}};
}
