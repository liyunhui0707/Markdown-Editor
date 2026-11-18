// Compare the complete PM tree with a fresh source projection without building
// two disposable PM trees per key. Defaults come from the same schema; this is
// a local proof, never a renderer assertion accepted by main.
function sameValue(a,b){
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 if(Array.isArray(a)&&a.length!==b.length)return false;
 const keys=Object.keys(a),other=Object.keys(b);
 return keys.length===other.length&&keys.every(k=>Object.hasOwn(b,k)&&sameValue(a[k],b[k]));
}
function sameAttrs(actual,json,type){
 if(json!=null&&(typeof json!=='object'||Array.isArray(json)))return false;
 if(json&&Object.keys(json).some(k=>!Object.hasOwn(type.attrs,k)))return false;
 for(const key of Object.keys(type.attrs)){
  const attribute=type.attrs[key],value=json?.[key]===undefined?attribute.default:json[key];
  if(!sameValue(actual[key],value))return false;
 }
 return true;
}
function markup(node,json,schema){
 if(!node||!json||typeof json!=='object'||node.type.schema!==schema||schema.nodes[json.type]!==node.type)return false;
 if(Object.keys(json).some(k=>!['type','attrs','marks','text','content'].includes(k)))return false;
 let marks=json.marks??[];
 if(!Array.isArray(marks)||marks.length!==node.marks.length)return false;
 let rank=-1,ordered=true;
 for(const mark of marks){
  const type=mark&&schema.marks[mark.type];if(!type)return false;
  if(type.rank<rank)ordered=false;rank=type.rank;
 }
 // Mark.setFrom sorts by schema rank; only unusual input needs a tiny copy.
 if(!ordered)marks=marks.slice().sort((a,b)=>schema.marks[a.type].rank-schema.marks[b.type].rank);
 for(let i=0;i<marks.length;i++){
  const mark=marks[i],actual=node.marks[i];
  if(!mark||schema.marks[mark.type]!==actual.type||!sameAttrs(actual.attrs,mark.attrs,actual.type))return false;
 }
 if(!sameAttrs(node.attrs,json.attrs,node.type))return false;
 return true;
}
export function matchesPMProjection(node,json,schema=node?.type?.schema){
 if(!markup(node,json,schema))return false;
 if(node.isText)return typeof json.text==='string'&&json.text===node.text&&json.content===undefined;
 if(json.text!==undefined)return false;
 const children=json.content===undefined?[]:json.content;
 if(!Array.isArray(children))return false;
 let actualIndex=0;
 for(let i=0;i<children.length;){
  const actual=node.maybeChild(actualIndex++),child=children[i];if(!actual)return false;
  if(child?.type!=='text'){
   if(!matchesPMProjection(actual,child,schema))return false;i++;continue;
  }
  // Fragment.fromJSON joins adjacent text with equal canonical marks. Match
  // every segment against that one PM text node without building a fragment or
  // concatenating the whole document. Different marks must stay distinct.
  if(!actual.isText||!markup(actual,child,schema))return false;
  let offset=0;
  do{
   const part=children[i];
   if(typeof part.text!=='string'||!part.text||part.content!==undefined||!actual.text.startsWith(part.text,offset))return false;
   offset+=part.text.length;i++;
  }while(i<children.length&&children[i]?.type==='text'&&markup(actual,children[i],schema));
  if(offset!==actual.text.length)return false;
 }
 return actualIndex===node.childCount;
}
