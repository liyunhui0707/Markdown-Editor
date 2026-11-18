// Compare the complete PM tree with a fresh source projection without building
// two disposable PM trees per key. Defaults come from the same schema; this is
// a local proof, never a renderer assertion accepted by main.
function sameValue(a,b){
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
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
export function matchesPMProjection(node,json,schema=node?.type?.schema){
 if(!node||!json||typeof json!=='object'||node.type.schema!==schema||schema.nodes[json.type]!==node.type)return false;
 if(Object.keys(json).some(k=>!['type','attrs','marks','text','content'].includes(k)))return false;
 const marks=json.marks??[];
 if(!Array.isArray(marks)||marks.length!==node.marks.length)return false;
 for(let i=0;i<marks.length;i++){
  const mark=marks[i],actual=node.marks[i];
  if(!mark||schema.marks[mark.type]!==actual.type||!sameAttrs(actual.attrs,mark.attrs,actual.type))return false;
 }
 if(!sameAttrs(node.attrs,json.attrs,node.type))return false;
 if(node.isText)return typeof json.text==='string'&&json.text===node.text&&json.content===undefined;
 if(json.text!==undefined)return false;
 const children=json.content===undefined?[]:json.content;
 if(!Array.isArray(children)||children.length!==node.childCount)return false;
 for(let i=0;i<children.length;i++)if(!matchesPMProjection(node.child(i),children[i],schema))return false;
 return true;
}
