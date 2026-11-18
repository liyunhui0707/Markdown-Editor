// A read-only semantic view, deliberately separate from exact editable ranges.
// Only parser-owned text and whitelisted tags are rendered. URLs are labels,
// never resource/navigation attributes; raw HTML stays in source fallback.
const tags=new Set(['p','h1','h2','h3','h4','h5','h6','strong','em','s','code','pre','br','hr','blockquote','ul','ol','li','span','table','thead','tbody','tr','th','td']);
export function previewDOMSpec(tree){
 if(typeof tree==='string')return tree;
 if(!tree||!tags.has(tree.tag)||!Array.isArray(tree.children))return ['span',{},'无法预览，请查看源码'];
 const attrs={};if(typeof tree.title==='string')attrs.title=tree.title;
 if(tree.link)attrs['data-document-link']='';
 if(tree.tag==='ol'&&Number.isSafeInteger(tree.start)&&tree.start>=0)attrs.start=tree.start;
 return [tree.tag,attrs,...tree.children.map(previewDOMSpec)];
}

export function semanticPreview(node,definitions,source){
 if(!['paragraph','heading','blockquote','list','table','thematicBreak'].includes(node.type))return null;
 // Keep extension-like directives and rejected standalone image references in
 // the existing verbatim view; neither is a decoded prose rendering gap.
 if(node.type==='paragraph'&&(/^:::/.test(source.slice(node.position.start.offset,node.position.end.offset))
   ||node.children?.length===1&&['image','imageReference'].includes(node.children[0].type)))return null;
 function convert(n,depth=0){
  if(depth>32)return null;
  if(n.type==='definition')return {tag:'span',children:[]};
  if(n.type==='text')return n.value;
  if(n.type==='inlineCode')return {tag:'code',children:[n.value]};
  if(n.type==='code')return {tag:'pre',children:[{tag:'code',children:[n.value]}]};
  if(n.type==='break')return {tag:'br',children:[]};
  if(n.type==='thematicBreak')return {tag:'hr',children:[]};
  if(n.type==='image'||n.type==='imageReference')return {tag:'span',title:'图片引用未自动加载',children:['[图片：'+(n.alt||'')+']']};
  let tag=({paragraph:'p',heading:'h'+n.depth,strong:'strong',emphasis:'em',delete:'s',blockquote:'blockquote',
   list:n.ordered?'ol':'ul',listItem:'li',link:'span',linkReference:'span',table:'table',tableRow:'tr',tableCell:'td'})[n.type];
  if(!tag||!Array.isArray(n.children))return null;
  const children=n.children.map(c=>convert(c,depth+1));if(children.some(c=>c===null))return null;
  const tree={tag,children};
  if(n.type==='list'&&n.ordered)tree.start=n.start??1;
  if(n.type==='listItem'&&typeof n.checked==='boolean')tree.children.unshift(n.checked?'☑ ':'☐ ');
  if(n.type==='link'||n.type==='linkReference'){
   const target=n.type==='link'?n:definitions.get(n.identifier.toLowerCase());if(!target)return null;
   tree.title=target.url+(target.title?' — '+target.title:'');tree.link=true;
  }
  return tree;
 }
 const tree=convert(node);if(!tree)return null;
 return {type:'documentPreview',attrs:{kind:node.type==='thematicBreak'?'horizontalRule':node.type,tree}};
}
