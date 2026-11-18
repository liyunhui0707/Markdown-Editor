// Exact comparison of internal JSON projections. Preserve key and array order,
// every neighboring node/attribute and primitive type without allocating two
// whole-document JSON strings for each ordinary key. Never an IPC proof flag.
export function equalProjection(a,b){
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 if(Array.isArray(a)){
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(!equalProjection(a[i],b[i]))return false;
  return true;
 }
 if(Object.getPrototypeOf(a)!==Object.prototype||Object.getPrototypeOf(b)!==Object.prototype)return false;
 const keys=Object.keys(a),other=Object.keys(b);
 if(keys.length!==other.length)return false;
 for(let i=0;i<keys.length;i++)if(keys[i]!==other[i]||!equalProjection(a[keys[i]],b[keys[i]]))return false;
 return true;
}
