// Exact inline source leaves only. No Markdown normalization or nested marks.
export function projectInlineLeaf(child, source) {
  const bold=child.type==='strong', italic=child.type==='emphasis', code=child.type==='inlineCode', link=child.type==='link';
  const leaf=(bold||italic||link)&&child.children?.length===1?child.children[0]:child;
  let a=leaf.position?.start.offset,b=leaf.position?.end.offset;
  if(code){a++;b--;}
  const value=leaf.value;
  if((code?leaf.type!=='inlineCode':leaf.type!=='text') || typeof value!=='string' || !value
      || /[\0\r\n]/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
      || source.slice(a,b)!==value) return null;
  if(code) {
    // One backtick pair; reject padding removal, multiline normalization and embedded delimiters.
    if(value.includes('`') || source[a-1]!=='`' || source[b]!=='`')return null;
  } else if(/[<>{}\\`$|]/.test(value))return null;
  if(bold||italic){
    const marker=source.slice(child.position.start.offset,a);
    if(!(bold?['**','__']:['*','_']).includes(marker) || source.slice(b,child.position.end.offset)!==marker)return null;
  }
  if(link && (child.position.start.line!==child.position.end.line
      || source.slice(child.position.start.offset,a)!=='[' || source.slice(b,b+2)!==']('
      || source[child.position.end.offset-1]!==')'))return null;
  let linkSource;
  if(link){
    const tail=source.slice(b+2,child.position.end.offset-1);
    const match=tail.match(/^([ \t]*)(<[^<>\r\n]*>|[^ \t\r\n]*)([\s\S]*)$/);
    if(match)linkSource={from:child.position.start.offset,to:child.position.end.offset,
      destinationFrom:b+2+match[1].length,destinationTo:b+2+match[1].length+match[2].length};
  }
  return {...(linkSource?{linkSource}:{}),text:value,sourceFrom:a,sourceTo:b,bold,...(italic?{italic:true}:{}),...(code?{code:true}:{}),...(link?{link:{href:child.url,title:child.title??null}}:{})};
}

export function inlineTextNode(part) {
  const mark=part.link?{type:'link',attrs:part.link}:part.bold||part.italic||part.code
    ?{type:part.bold?'bold':part.italic?'italic':'code'}:null;
  return {type:'text',text:part.text,...(mark?{marks:[mark]}:{})};
}
