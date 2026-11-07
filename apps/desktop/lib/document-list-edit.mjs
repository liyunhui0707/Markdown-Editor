import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
const rejectListEdit=()=>({ok:false,code:'unsafe-format-range'});
const cutsListSurrogate=(s,n)=>/[\uD800-\uDBFF]/.test(s[n-1]||'')&&/[\uDC00-\uDFFF]/.test(s[n]||'');
const listMarkType=p=>p.bold?'bold':p.italic?'italic':p.code?'code':null;
const listInlineNodes=pieces=>pieces.filter(p=>p.text).map(p=>({type:'text',text:p.text,...(listMarkType(p)?{marks:[{type:listMarkType(p)}]}:{})}));
const renderListPieces=pieces=>pieces.map(p=>(p.marker||'')+p.text+(p.marker||'')).join('');
// All commands are resolved against the current projection in main. A bounded
// tree of original source lines permits moving subtrees without serializing Markdown.
export function mapListEdit(source,p,{action,from,to},project) {
  const index=p.blocks.findIndex(b=>b&&from>b.from&&to<b.to),block=p.blocks[index];
  if(!block?.items||from!==to)return rejectListEdit();
  const rows=block.items,row=rows.find(r=>from>=r.from&&from<=r.to);if(!row)return rejectListEdit();
  const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||source.match(/\r\n|\n|\r/)?.[0]||'\n';
  const expected=structuredClone(p.doc),byPath=new Map(rows.map(r=>[JSON.stringify(r.path),r]));
  let selected,parentList,parentItem,grandList;
  function build(n,path=[],owner=null,outer=null) {
    const list={type:n.type,start:n.attrs?.start,items:[]};
    n.content.forEach((item,i)=>{
      const itemPath=[...path,i],r=byPath.get(JSON.stringify(itemPath));
      const value={row:r,marker:r.marker,indent:r.indent,checked:r.checked,
        body:source.slice(r.bodyFrom,r.sourceTo),content:structuredClone(item.content[0].content),child:null};
      list.items.push(value);
      if(r===row){selected=value;parentList=list;parentItem=owner;grandList=outer;}
      if(item.content[1])value.child=build(item.content[1],[...itemPath,1],value,list);
    });return list;
  }
  const tree=build(p.doc.content[index]);
  // Retain the user's original X spelling and all unchanged source bytes.
  for(const r of rows)r.taskMark=r.checked===null?'':source.slice(r.sourceFrom+r.marker.length,r.bodyFrom);
  const lines=list=>list.items.flatMap(v=>[v.indent+v.marker+(v.checked===null?'':v.taskMark??v.row.taskMark)+v.body,...(v.child?lines(v.child):[])]);
  const toDoc=list=>({type:list.type,...(list.type==='orderedList'?{attrs:{start:list.start}}:{}),content:list.items.map(v=>({type:'listItem',...(v.checked===null?{}:{attrs:{checked:v.checked}}),content:[{type:'paragraph',content:v.content},...(v.child?[toDoc(v.child)]:[])]}))});
  const shift=(v,amount)=>{if(amount<0&&!v.indent.startsWith(' '.repeat(-amount)))throw Error('indent');v.indent=amount<0?v.indent.slice(-amount):' '.repeat(amount)+v.indent;if(v.child)for(const c of v.child.items)shift(c,amount);};
  const original=source.slice(block.sourceFrom,block.sourceTo);
  // A root list may have a small source indentation. The block starts at its marker.
  const rootIndent=tree.items[0].indent;
  const sourceOf=()=>lines(tree).join(nl).slice(rootIndent.length);
  if(sourceOf()!==original)return rejectListEdit();
  let target=selected,offset=from-row.from,exit=null;
  const i=parentList.items.indexOf(selected);
  try {
    if(action==='toggle-task') {
      if(selected.checked===null)return rejectListEdit();selected.checked=!selected.checked;selected.taskMark=`[${selected.checked?'x':' '}] `;
    } else if(action==='task-list') {
      selected.checked=selected.checked===null?false:null;selected.taskMark=selected.checked===null?'':'[ ] ';
    } else if(action==='task-shortcut') {
      if(selected.checked!==null||offset!==3||!/^\[[ xX]\]/.test(selected.body)||selected.content.length!==1||selected.content[0].marks)return rejectListEdit();
      selected.checked=selected.body[1]!==' ';selected.taskMark=selected.body.slice(0,3)+' ';selected.body=selected.body.slice(3);
      selected.content=selected.body?[{type:'text',text:selected.body}]:[];offset=0;
    } else if(action==='indent-list') {
      const previous=parentList.items[i-1];if(!previous)return rejectListEdit();
      if(previous.child&&(previous.child.type!==parentList.type||previous.child.items[0].marker.trim().at(-1)!==selected.marker.trim().at(-1)))return rejectListEdit();
      const depth=row.path.length/2;if(depth>=5.5)return rejectListEdit();
      // A new ordered sublist must start at 1 to interrupt its parent's
      // paragraph. Do not reinterpret an empty bullet as nested content.
      if(!previous.child&&parentList.type==='orderedList')selected.marker='1'+selected.marker.trim().at(-1)+' ';
      const width=previous.marker.length;
      const indent=previous.child?.items[0].indent??previous.indent+' '.repeat(width);
      shift(selected,indent.length-selected.indent.length);parentList.items.splice(i,1);
      if(!previous.child)previous.child={type:parentList.type,start:parentList.type==='orderedList'?parseInt(selected.marker,10):undefined,items:[]};
      previous.child.items.push(selected);
    } else if(action==='outdent-list'||action==='split-list'&&!selected.body&&parentItem||action==='join-list'&&offset===0&&i===0&&parentItem) {
      if(!parentItem||!grandList)return rejectListEdit();
      const following=parentList.items.splice(i+1);parentList.items.splice(i,1);
      if(!parentList.items.length)parentItem.child=null;
      shift(selected,parentItem.indent.length-selected.indent.length);
      // Subsequent siblings become children, as in a conventional lift-list-item.
      if(following.length) {
        if(selected.child&&selected.child.type!==parentList.type)return rejectListEdit();
        const indent=selected.child?.items[0].indent??selected.indent+' '.repeat(selected.marker.length);
        for(const v of following)shift(v,indent.length-v.indent.length);
        if(!selected.child)selected.child={type:parentList.type,start:parentList.type==='orderedList'?parseInt(following[0].marker,10):undefined,items:[]};
        selected.child.items.push(...following);
      }
      // Crossing list kinds changes this marker only; child markers remain intact.
      if(grandList.type!==parentList.type){selected.marker=parentItem.marker;}
      grandList.items.splice(grandList.items.indexOf(parentItem)+1,0,selected);
    } else if(action==='split-list'&&!selected.body||action==='join-list'&&offset===0&&i===0) {
      if(parentItem||selected.child||i!==parentList.items.length-1&&i!==0)return rejectListEdit();
      parentList.items.splice(i,1);exit={type:'paragraph',content:selected.content};
      target=null;offset=0;
    } else if(action==='split-list'||action==='join-list') {
      function pieces(value) {
        const parts=p.spans.filter(s=>s.blockIndex===index&&s.itemIndex===rows.indexOf(value.row));
        if(parts.some(s=>s.link||s.textOffset!==undefined))return null;
        const values=parts.map(s=>({...s,marker:listMarkType(s)?source.slice(s.sourceFrom-(s.bold?2:1),s.sourceFrom):''}));
        return renderListPieces(values)===value.body?values:null;
      }
      const parts=pieces(selected);if(!parts)return rejectListEdit();
      const text=parts.map(p=>p.text).join('');if(cutsListSurrogate(text,offset))return rejectListEdit();
      if(action==='split-list') {
        const left=[],right=[];let n=offset;
        for(const part of parts){const a=Math.min(Math.max(n,0),part.text.length);if(a)left.push({...part,text:part.text.slice(0,a)});if(a<part.text.length)right.push({...part,text:part.text.slice(a)});n-=part.text.length;}
        const next={...selected,checked:selected.checked===null?null:false,taskMark:selected.checked===null?'':'[ ] ',body:renderListPieces(right),content:listInlineNodes(right)};
        if(parentList.type==='orderedList')next.marker=`${Math.min(999999999,parseInt(selected.marker,10)+1)}${selected.marker.trim().at(-1)} `;
        selected.body=renderListPieces(left);selected.content=listInlineNodes(left);selected.child=null;
        parentList.items.splice(i+1,0,next);target=next;offset=0;
      } else {
        if(offset!==0||i===0)return rejectListEdit();
        const previous=parentList.items[i-1],left=pieces(previous);if(!left||previous.child)return rejectListEdit();
        const merged=[];for(const part of [...left,...parts]){if(!part.text)continue;const last=merged.at(-1);if(last&&listMarkType(last)===listMarkType(part))last.text+=part.text;else merged.push({...part});}
        offset=left.map(p=>p.text).join('').length;previous.body=renderListPieces(merged);previous.content=listInlineNodes(merged);previous.child=selected.child;
        parentList.items.splice(i,1);target=previous;
      }
    } else return rejectListEdit();
  } catch{return rejectListEdit();}
  let text=sourceOf(),targetIndex=index;
  if(exit){
    if(tree.items.length){
      if(i===0){text=selected.body+nl+nl+text;expected.content.splice(index,1,exit,toDoc(tree));}
      else{text+=nl+nl+selected.body;expected.content.splice(index,1,toDoc(tree),exit);targetIndex++;}
    }else{text=selected.body;expected.content[index]=exit;}
  } else expected.content[index]=toDoc(tree);
  let a=block.sourceFrom,b=block.sourceTo,start=0,end=original.length,nextEnd=text.length;
  while(start<end&&start<nextEnd&&original[start]===text[start])start++;if(cutsListSurrogate(original,start)||cutsListSurrogate(text,start))start--;
  while(end>start&&nextEnd>start&&original[end-1]===text[nextEnd-1]){end--;nextEnd--;}if(cutsListSurrogate(original,end)||cutsListSurrogate(text,nextEnd)){end++;nextEnd++;}
  a+=start;b=block.sourceFrom+end;text=text.slice(start,nextEnd);
  if(text.length>4096||b-a>4096)return rejectListEdit();
  const next=source.slice(0,a)+text+source.slice(b);if(next.length>MAX_SOURCE_UNITS)return rejectListEdit();
  const projection=project(next);if(JSON.stringify(projection.doc)!==JSON.stringify(expected))return rejectListEdit();
  const flattened=[];const flatten=l=>{for(const v of l.items){flattened.push(v);if(v.child)flatten(v.child);}};flatten(tree);
  const pos=target?projection.blocks[index]?.items?.[flattened.indexOf(target)]?.from+offset:projection.blocks[targetIndex]?.from+1;
  if(!Number.isSafeInteger(pos))return rejectListEdit();
  return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from:pos,to:pos}};
}
