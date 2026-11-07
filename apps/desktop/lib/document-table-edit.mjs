import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
import {TABLE_ROWS,TABLE_COLUMNS,tableCell} from './document-table-source.mjs';
const reject=()=>({ok:false,code:'unsafe-format-range'});
export const tableActions=['insert-table','table-add-row','table-delete-row','table-add-column','table-delete-column','table-exit'];
const emptyParagraph=()=>({type:'paragraph',content:[]});

// Main and renderer run the same bounded mapper. No new IPC, save capability,
// arbitrary source offsets or whole-document serializer is introduced.
export function mapTableEdit(source,p,{action,from,to},project) {
  if(from!==to)return reject();
  const index=p.blocks.findIndex(b=>b&&from>b.from&&from<b.to);if(index<0)return reject();
  const block=p.blocks[index],expected=structuredClone(p.doc),node=expected.content[index];
  const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||source.match(/\r\n|\n|\r/)?.[0]||'\n';
  let a,b,text,targetIndex=index,targetRow=0,targetCol=0,prose=false;
  if(action==='insert-table') {
    if(node.type!=='paragraph'||!p.spans.some(s=>s.blockIndex===index&&s.textOffset===undefined&&from>=s.from&&from<=s.to))return reject();
    const created={type:'table',content:[{type:'tableRow',content:[tableCell('列 1',true),tableCell('列 2',true)]},
      ...Array.from({length:2},()=>({type:'tableRow',content:[tableCell('',false),tableCell('',false)]}))]};
    text=['|列 1|列 2|','|---|---|','|||','|||'].join(nl);a=b=block.sourceTo;
    if(!node.content.length){expected.content[index]=created;a=block.sourceFrom;}
    else {text=nl+nl+text;expected.content.splice(index+1,0,created);targetIndex++;}
  } else {
    if(!block.cells)return reject();
    const cell=block.cells.flat().find(c=>from>=c.from&&from<=c.to);if(!cell)return reject();
    targetRow=cell.tableRow;targetCol=cell.tableCol;
    const rows=node.content.length,cols=node.content[0].content.length;
    const lines=block.tableLines.map(l=>({...l,values:[...l.values]}));
    a=block.sourceFrom;b=block.sourceTo;
    if(action==='table-add-row') {
      if(rows>=TABLE_ROWS)return reject();targetRow++;targetCol=0;
      const i=targetRow+1,previous=lines[i-1],eol=previous.eol||nl;
      lines.splice(i,0,{values:Array(cols).fill(''),eol:previous.eol});previous.eol=eol;
      node.content.splice(targetRow,0,{type:'tableRow',content:node.content[0].content.map(c=>tableCell('',false,c.attrs.align))});
    } else if(action==='table-delete-row') {
      if(targetRow===0)return reject();const i=targetRow+1;
      if(i===lines.length-1)lines[i-1].eol=lines[i].eol;
      lines.splice(i,1);node.content.splice(targetRow,1);targetRow=Math.min(targetRow,rows-2);
    } else if(action==='table-add-column'||action==='table-delete-column') {
      const add=action==='table-add-column';if(add?cols>=TABLE_COLUMNS:cols<=1)return reject();
      const col=targetCol+(add?1:0);
      for(const [i,line] of lines.entries())line.values.splice(col,add?0:1,...(add?[i===1?'---':'']:[]));
      for(const [i,row] of node.content.entries())row.content.splice(col,add?0:1,...(add?[tableCell('',i===0)]:[]));
      targetCol=add?col:Math.min(col,cols-2);
    } else if(action==='table-exit') {
      // Reuse an already editable prose block; otherwise insert one exact gap.
      const next=p.blocks[index+1];
      if(expected.content[index+1]?.type==='paragraph'&&next){
        return {ok:true,source,projection:p,change:{from:b,to:b,insert:''},inverseSource:{from:b,to:b,insert:''},selection:{from:next.from+1,to:next.from+1}};
      }
      a=b;text=nl+nl;expected.content.splice(index+1,0,emptyParagraph());targetIndex++;prose=true;
    } else return reject();
    if(text===undefined)text=lines.map(l=>'|'+l.values.join('|')+'|'+l.eol).join('');
  }
  // Return one minimal source splice; untouched cell spelling, delimiters and
  // line endings stay byte-identical. History retains the exact inverse.
  let old=source.slice(a,b),start=0,end=old.length,last=text.length;
  while(start<end&&start<last&&old[start]===text[start])start++;
  const splits=(s,n)=>/[\uD800-\uDBFF]/.test(s[n-1]||'')&&/[\uDC00-\uDFFF]/.test(s[n]||'');
  if(splits(old,start)||splits(text,start))start--;
  while(end>start&&last>start&&old[end-1]===text[last-1]){end--;last--;}
  if(splits(old,end)||splits(text,last)){end++;last++;}
  b=a+end;a+=start;text=text.slice(start,last);
  if(text.length>4096||b-a>4096)return reject();
  const next=source.slice(0,a)+text+source.slice(b);if(next.length>MAX_SOURCE_UNITS)return reject();
  const projection=project(next);if(JSON.stringify(projection.doc)!==JSON.stringify(expected))return reject();
  const target=projection.blocks[targetIndex],pos=prose?target?.from+1:target?.cells?.[targetRow]?.[targetCol]?.from;
  if(!Number.isSafeInteger(pos))return reject();
  return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from:pos,to:pos}};
}
