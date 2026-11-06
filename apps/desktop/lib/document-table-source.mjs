export const TABLE_ROWS = 32, TABLE_COLUMNS = 8;
const inline = text => text ? [{type:'text',text}] : [];
export const tableCell = (text,header,align=null) => ({type:header?'tableHeader':'tableCell',attrs:{align},content:[{type:'paragraph',content:inline(text)}]});
const valid = text => !/[\x00-\x1f\x7f|\\\u2028\u2029]/u.test(text)
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
const splitSurrogate = (s,n) => /[\uD800-\uDBFF]/.test(s[n-1]||'')&&/[\uDC00-\uDFFF]/.test(s[n]||'');

// An exact, rectangular pipe table only. Padding is part of each editable cell,
// so typing/removing spaces never silently normalizes the original source.
export function projectTable(node,source,position,blockIndex) {
  if(node.type!=='table'||node.children.length>TABLE_ROWS||node.align.length>TABLE_COLUMNS)return null;
  const start=node.position.start.offset,end=node.position.end.offset;
  const lines=[],raw=source.slice(start,end);
  for(const m of raw.matchAll(/([^\r\n]+)(\r\n|\n|\r|$)/g)) {
    const text=m[1];if(!text.startsWith('|')||!text.endsWith('|'))return null;
    const values=text.slice(1,-1).split('|');
    if(values.length!==node.align.length||!values.length||values.some(t=>!valid(t)))return null;
    lines.push({text,values,from:start+m.index,to:start+m.index+text.length,eol:m[2]});
  }
  if(lines.length!==node.children.length+1||lines[1].values.some(s=>!/^ *:?-{3,}:? *$/.test(s)))return null;
  const content=[],spans=[],cells=[];let pos=position+1;
  for(const [row,n] of node.children.entries()) {
    const line=lines[row?row+1:0];if(n.children.length!==line.values.length)return null;
    const children=[],mapped=[];let at=line.from+1;pos++;
    for(const [col,text] of line.values.entries()) {
      const childrenMd=n.children[col].children;
      if(childrenMd.length>1||(childrenMd.length===1&&(childrenMd[0].type!=='text'||childrenMd[0].value!==text.trim())))return null;
      if(!childrenMd.length&&text.trim())return null;
      const cell={text,sourceFrom:at,sourceTo:at+text.length,from:pos+2,to:pos+2+text.length,
        tableRow:row,tableCol:col,blockIndex,childIndex:0,bold:false};
      children.push(tableCell(text,row===0,node.align[col]));mapped.push(cell);spans.push(cell);
      pos+=text.length+4;at+=text.length+1;
    }
    cells.push(mapped);content.push({type:'tableRow',content:children});pos++;
  }
  pos++;
  return {doc:{type:'table',content},spans,size:pos-position,
    block:{from:position,to:pos,sourceFrom:start,sourceTo:end,cells,tableLines:lines}};
}

export function mapTableText(source,projection,change,project) {
  const {from,to,insert}=change;
  const spans=projection.spans.filter(s=>s.tableRow!==undefined);
  if(!spans.some(s=>from>=s.from&&from<=s.to||to>=s.from&&to<=s.to))return null;
  const reject=()=>({ok:false,code:'unsafe-source-range'});
  const cell=spans.find(s=>from>=s.from&&to<=s.to);
  if(!cell||!valid(insert)||splitSurrogate(cell.text,from-cell.from)||splitSurrogate(cell.text,to-cell.from))return reject();
  const a=cell.sourceFrom+from-cell.from,b=cell.sourceFrom+to-cell.from;
  const next=source.slice(0,a)+insert+source.slice(b);if(next.length>131072)return reject();
  const expected=structuredClone(projection.doc),text=cell.text.slice(0,from-cell.from)+insert+cell.text.slice(to-cell.from);
  expected.content[cell.blockIndex].content[cell.tableRow].content[cell.tableCol].content[0].content=inline(text);
  const result=project(next);if(JSON.stringify(result.doc)!==JSON.stringify(expected))return reject();
  return {ok:true,source:next,projection:result,change:{from:a,to:b,insert},
    inverseSource:{from:a,to:a+insert.length,insert:source.slice(a,b)},selection:{from:from+insert.length,to:from+insert.length}};
}
