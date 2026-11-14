import {projectInlineParts} from './document-inline-tree.mjs';
import { inlineTextNode } from './document-inline-leaf.mjs';
export const listNodeAt = (node, path) => path.reduce((n,i)=>n.content[i],node);
export const sameListParent = (a,b) => JSON.stringify(a.path.slice(0,-1))===JSON.stringify(b.path.slice(0,-1));
// Tight lists, one source line per item, at most six levels / 32 items total.
// Unprojectable children protect the entire list; never normalize source bytes.
export function projectSimpleList(node, source, position, blockIndex) {
  const spans=[],items=[];let childIndex=0;
  function walk(list,at,path=[],depth=0) {
    if(list.type!=='list'||list.spread||depth>=6)return null;
    const content=[];let offset=at+1,previousEnd=null;
    for(const [siblingIndex,item] of list.children.entries()) {
      if(items.length>=32||item.spread)return null;
      const a=item.position.start.offset,b=item.position.end.offset;
      const lineFrom=Math.max(source.lastIndexOf('\n',a-1),source.lastIndexOf('\r',a-1))+1;
      const indent=source.slice(lineFrom,a);if(!/^ *$/.test(indent))return null;
      const lineEnd=a+(source.slice(a,b).search(/[\r\n]/)<0?b-a:source.slice(a,b).search(/[\r\n]/));
      const raw=source.slice(a,lineEnd),marker=raw.match(list.ordered?/^(\d{1,9}[.)] )/:/^([-+*] )/)?.[0];
      if(!marker||previousEnd!==null&&!/^(?:\r\n|\n|\r) *$/.test(source.slice(previousEnd,a)))return null;
      const task=raw.slice(marker.length).match(/^\[([ xX])\] /),checked=task?task[1]!==' ':null;
      const bodyFrom=a+marker.length+(task?4:0),itemIndex=items.length,itemPath=[...path,siblingIndex];
      const children=item.children,paragraph=children[0]?.type==='paragraph'?children[0]:null;
      if(children.length>(paragraph?2:1)||children.slice(paragraph?1:0).some(n=>n.type!=='list')
        ||paragraph&&paragraph.position.end.line!==paragraph.position.start.line)return null;
      if(item.checked!==null&&!task)return null;
      const inline=[],parts=[];let length=0;
      for(const child of bodyFrom===lineEnd?[]:paragraph?.children||[]) {
        const chunk=projectInlineParts(child,source);if(!chunk)return null;
        for(const part of chunk){if(part.sourceFrom<bodyFrom)return null;
        inline.push(inlineTextNode(part));parts.push({...part,from:offset+2+length,to:offset+2+length+part.text.length,
          blockIndex,childIndex:childIndex++,itemIndex,itemPath,inlineIndex:inline.length-1});length+=part.text.length;}
      }
      if(inline.length===1&&!parts[0].bold&&!parts[0].italic&&!parts[0].code&&!parts[0].link) {
        const text=source.slice(bodyFrom,lineEnd);if(text.trimStart()!==text)return null;
        inline[0].text=text;Object.assign(parts[0],{text,sourceFrom:bodyFrom,sourceTo:lineEnd,to:parts[0].from+text.length});length=text.length;
      } else if(!inline.length) {
        if(bodyFrom!==lineEnd)return null;
        parts.push({text:'',sourceFrom:lineEnd,sourceTo:lineEnd,bold:false,from:offset+2,to:offset+2,
          blockIndex,childIndex:childIndex++,itemIndex,itemPath,inlineIndex:0});
      } else if(source.slice(bodyFrom,parts[0].sourceFrom)!==(parts[0].frames?source.slice(parts[0].frames[0].from,parts[0].sourceFrom):parts[0].link?'[':parts[0].bold||parts[0].italic||parts[0].code?source.slice(parts[0].sourceFrom-(parts[0].bold?2:1),parts[0].sourceFrom):''))return null;
      const row={sourceFrom:a,sourceTo:lineEnd,subtreeTo:b,lineFrom,indent,bodyFrom,marker,checked,
        path:itemPath,siblingIndex,from:offset+2,to:offset+2+length};items.push(row);spans.push(...parts);
      const itemContent=[{type:'paragraph',content:inline}];let size=length+4;
      const nested=children[paragraph?1:0];
      if(nested){
        if(!/^(?:\r\n|\n|\r) +$/.test(source.slice(lineEnd,nested.position.start.offset)))return null;
        const sub=walk(nested,offset+length+3,[...itemPath,1],depth+1);if(!sub)return null;
        itemContent.push(sub.doc);size+=sub.size;
      }
      content.push({type:'listItem',...(checked===null?{}:{attrs:{checked}}),content:itemContent});
      offset+=size;previousEnd=b;
    }
    return {doc:{type:list.ordered?'orderedList':'bulletList',...(list.ordered?{attrs:{start:list.start}}:{}),content},size:offset-at+1};
  }
  if(node.type!=='list')return null;
  const result=walk(node,position);return result?{...result,spans,items}:null;
}
