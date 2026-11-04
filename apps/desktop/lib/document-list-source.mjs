// Only flat, tight, one-line items. Everything else remains a verbatim opaque block.
export function projectSimpleList(node, source, position, blockIndex) {
  if (node.type !== 'list' || node.spread || node.children.length > 32) return null;
  const content = [], spans = [], items = []; let offset = position + 1, previousEnd = null, childIndex = 0;
  for (const [itemIndex, item] of node.children.entries()) {
    const a = item.position.start.offset, b = item.position.end.offset, raw = source.slice(a, b);
    const marker = raw.match(node.ordered ? /^(\d{1,9}[.)] )/ : /^([-+*] )/);
    if (!marker || item.checked !== null || item.spread || item.position.start.line !== item.position.end.line
        || item.children.length > 1 || (item.children.length && item.children[0].type !== 'paragraph')
        || /[<>{}\\`$|]/.test(raw) || (previousEnd !== null && !/^(\r\n|\n|\r)$/.test(source.slice(previousEnd,a)))) return null;
    const inline = [], itemSpans = [], bodyFrom = a + marker[0].length;
    let textOffset = 0;
    for (const child of item.children[0]?.children || []) {
      const bold = child.type === 'strong', leaf = bold && child.children?.length === 1 ? child.children[0] : child;
      const start = leaf.position?.start.offset, end = leaf.position?.end.offset;
      if (leaf.type !== 'text' || !leaf.value || /[\r\n\0]/.test(leaf.value) || source.slice(start,end) !== leaf.value
          || (bold && !['**','__'].includes(source.slice(child.position.start.offset,start)))) return null;
      inline.push({type:'text',text:leaf.value,...(bold?{marks:[{type:'bold'}]}:{})});
      itemSpans.push({text:leaf.value,sourceFrom:start,sourceTo:end,bold,
        from:offset+2+textOffset,to:offset+2+textOffset+leaf.value.length,blockIndex,childIndex:childIndex++,itemIndex,inlineIndex:inline.length-1});
      textOffset += leaf.value.length;
    }
    // remark drops trailing spaces. Keep them as literal text, or refuse marked margins.
    if (inline.length === 1 && !itemSpans[0].bold) {
      const text = source.slice(bodyFrom,b);
      if (text.trimStart() !== text) return null;
      inline[0].text=text; itemSpans[0].text=text; itemSpans[0].sourceFrom=bodyFrom; itemSpans[0].sourceTo=b;
      itemSpans[0].to=itemSpans[0].from+text.length; textOffset=text.length;
    } else if (!inline.length) {
      if (b !== bodyFrom) return null;
      itemSpans.push({text:'',sourceFrom:b,sourceTo:b,bold:false,from:offset+2,to:offset+2,blockIndex,childIndex:childIndex++,itemIndex,inlineIndex:0});
    } else if (source.slice(bodyFrom,itemSpans[0].sourceFrom) !== (itemSpans[0].bold ? source.slice(itemSpans[0].sourceFrom-2,itemSpans[0].sourceFrom) : '')) return null;
    items.push({sourceFrom:a,sourceTo:b,bodyFrom,marker:marker[0],from:offset+2,to:offset+2+textOffset});
    content.push({type:'listItem',content:[{type:'paragraph',content:inline}]}); spans.push(...itemSpans);
    offset += textOffset+4; previousEnd=b;
  }
  return {doc:{type:node.ordered?'orderedList':'bulletList',...(node.ordered?{attrs:{start:node.start}}:{}),content},spans,items,size:offset-position+1};
}
