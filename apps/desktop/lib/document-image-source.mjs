// Image references are Markdown text only. Never resolve paths or fetch URLs.
const validText=s=>typeof s==='string'&&!/[\u0000-\u001f\u007f]/.test(s)
 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
export const validImageLabel=s=>validText(s)&&s.length<=512&&!/[\[\]\\<>]/.test(s);
export function validImageTarget(s){
 if(!validText(s)||!s||s.length>2048||s.trim()!==s||/[<>"'\\]/.test(s)||/%(?:00|0a|0d)/i.test(s))return false;
 if(/^https?:/i.test(s)){
  try{const u=new URL(s);return !/\s/u.test(s)&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}
 }
 return !s.startsWith('/')&&!s.startsWith('#')&&!s.includes(':');
}
export const imageNode=(alt,src,title=null)=>({type:'documentImage',attrs:{alt,src,title}});
export function projectImage(node,source,position){
 if(node.type!=='paragraph'||node.children?.length!==1||node.children[0].type!=='image')return null;
 const child=node.children[0],start=node.position.start.offset,end=node.position.end.offset,raw=source.slice(start,end);
 const m=/^!\[([^\]\\\r\n]*)\]\((<[^<>\r\n]+>|[^\s()<>]+)([ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))?\)$/.exec(raw);
 if(!m||m[1]!==child.alt||!validImageLabel(child.alt)||!validImageTarget(child.url)
  ||(m[2].startsWith('<')?m[2].slice(1,-1):m[2])!==child.url)return null;
 return {doc:imageNode(child.alt,child.url,child.title??null),spans:[],size:1,
  block:{from:position,to:position+1,sourceFrom:start,sourceTo:end,
   image:{alt:child.alt,src:child.url,title:child.title??null,suffix:raw.slice(2+child.alt.length),titleSuffix:m[3]||''}}};
}
