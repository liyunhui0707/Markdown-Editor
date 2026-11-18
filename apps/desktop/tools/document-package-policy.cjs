'use strict';
const path=require('node:path'),fs=require('node:fs');
const base=require('../electron-builder.document.cjs');
// This is a closed copy policy, not a glob implementation. The lockfile owns
// dependency locations; the source tree owns the flat Document runtime files.
function runtimeFilter(root,lock){
 const privateNames=new Set(['.git','.local','.codex','.claude','.workflow','secrets','Inbox','e2e','test','tests','test-results','tools','spike']);
 const runtime=new Set(['package.json','document-app-main.js','lib/editor-path-policy.js',
  ...fs.readdirSync(path.join(root,'lib'),{withFileTypes:true}).filter(e=>e.isFile()&&e.name.startsWith('document-')&&!['document-demo-entry.js','document-demo-main.js'].includes(e.name)).map(e=>'lib/'+e.name)]);
 const modules=Object.entries(lock.packages).filter(([n])=>n.startsWith('node_modules/')).sort((a,b)=>b[0].length-a[0].length);
 const allowed=new Set(modules.filter(([n,p])=>!p.dev&&!n.split('/').includes('@toast-ui')).map(([n])=>n));
 const parents=new Set(['','lib']);
 for(const n of allowed)for(let p=path.posix.dirname(n);p!=='.';p=path.posix.dirname(p))parents.add(p);
 return file=>{
  const relative=path.relative(root,file).split(path.sep).join('/');
  if(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))return false;
  const parts=relative.split('/');
  if(parts.some(p=>privateNames.has(p)||p==='.env'||p.startsWith('.env.'))||parts.includes('.bin'))return false;
  if(parents.has(relative)||runtime.has(relative))return true;
  if(!relative.startsWith('node_modules/'))return false;
  const owner=modules.find(([n])=>relative===n||relative.startsWith(n+'/'));
  return !!owner&&allowed.has(owner[0]);
 };
}
function packageOptions({root,out,lock,signed=false,identity=''}){
 if(signed&&!/^Developer ID Application: [^\r\n\0]+ \([A-Z0-9]{10}\)$/.test(identity))throw Error('A full Developer ID Application certificate identity is required.');
 const include=runtimeFilter(root,lock),entitlements=path.join(root,'build/entitlements.mac.plist');
 return {dir:root,out,name:base.productName,appBundleId:base.appId,helperBundleId:base.appId+'.helper',
  appCategoryType:base.mac.category,arch:'arm64',platform:'darwin',asar:true,overwrite:false,prune:false,derefSymlinks:false,
  electronVersion:lock.packages['node_modules/electron'].version,icon:path.join(root,base.mac.icon),
  extraResource:[path.join(root,'build/document-save')],ignore:file=>!include(root+file),
  extendInfo:{LSMinimumSystemVersion:base.mac.minimumSystemVersion,
   CFBundleDocumentTypes:base.fileAssociations.map(a=>({CFBundleTypeName:a.name,CFBundleTypeExtensions:[a.ext],CFBundleTypeRole:a.role,LSHandlerRank:a.rank}))},
  osxSign:{identity:signed?identity:'-',identityValidation:signed,type:'distribution',continueOnError:false,
   optionsForFile:()=>({hardenedRuntime:signed,entitlements})},
 };
}
module.exports={runtimeFilter,packageOptions};
