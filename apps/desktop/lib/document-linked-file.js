'use strict';
const {randomUUID}=require('node:crypto');
const same=require('node:util').isDeepStrictEqual;
const {failure}=require('./document-contract');
// Main-only read capability derived from an already opened/bound document.
// Observations never rebase the draft, clear a stopped save or restore write authority.
function createLinkedFileAccess({store,sessions,openSnapshot,closeDocument}) {
 const comparisons=new WeakMap();
 const target=s=>s?.origin?.snapshot||(!s?.syntheticTemporary?s?.snapshot:null);
 const code=e=>['ENOENT','ENOTDIR'].includes(e.code)?'file-unavailable'
  :['EACCES','EPERM'].includes(e.code)?'read-failed'
  :['unsupported-file','unsupported-size','unsupported-path','external-change'].includes(e.code)?e.code:'read-failed';
 function getLinkedFile(document){
  const s=sessions.get(document),base=target(s);if(!base)return null;
  return {filePath:base.filePath,baselineSha256:base.sha256,
   checked:s.linkedCheck?.baseline===base?{...s.linkedCheck.observation}:null};
 }
 function inspectLinkedFile(document){
  const s=sessions.get(document),base=target(s);if(!base)return failure('linked-file-unavailable');
  let state,reason;
  try{const current=store.read(base.filePath);state=current.sha256===base.sha256&&same(current.identity,base.identity)&&current.bytes.equals(base.bytes)?'unchanged':'changed';}
  catch(e){reason=code(e);state=reason==='file-unavailable'?'missing':'unavailable';}
  s.linkedCheck={baseline:base,observation:{state,code:reason||null,checkedAt:Date.now()}};
  if(s.origin&&['changed','missing'].includes(state))s.origin.stopped=true;
  return {ok:true};
 }
 function openLinkedFile(document,parse){
  const base=target(sessions.get(document));if(!base)return failure('linked-file-unavailable');
  try{return openSnapshot(store.read(base.filePath),{parse});}catch(e){return failure(code(e));}
 }
 function navigationRecord(document){const base=target(sessions.get(document));return base?{filePath:base.requestedPath||base.filePath,identity:{...base.identity},originalBytes:Buffer.from(base.bytes),blocked:false}:null;}
 function matchesLinkedFile(document,original){
  const s=sessions.get(document),base=target(s),fresh=sessions.get(original)?.snapshot;
  return !!(s?.origin&&!s.origin.stopped&&base&&fresh&&base.filePath===fresh.filePath&&base.identity.dev===fresh.identity.dev&&base.identity.ino===fresh.identity.ino&&base.bytes.equals(fresh.bytes));
 }
 function compareLinkedFile(document,parse){
  const s=sessions.get(document),base=target(s);if(!base)return failure('linked-file-unavailable');comparisons.delete(document);let opened;
  try{
   const current=store.read(base.filePath);
   const state=current.sha256===base.sha256&&same(current.identity,base.identity)&&current.bytes.equals(base.bytes)?'unchanged':'changed';
   const checkedAt=Date.now();s.linkedCheck={baseline:base,observation:{state,code:null,checkedAt}};
   if(s.origin&&state==='changed')s.origin.stopped=true;
   opened=openSnapshot(current,{parse});if(!opened.ok)return failure(opened.code||'read-failed');
   const token=randomUUID();comparisons.set(document,{token,revision:document.revision,filePath:base.filePath,sha256:current.sha256,identity:current.identity});
   return {ok:true,comparison:{token,source:opened.document.text,bom:opened.document.bom,sha256:current.sha256,checkedAt,label:require('node:path').basename(base.filePath)}};
  }catch(e){const reason=code(e),state=reason==='file-unavailable'?'missing':'unavailable';s.linkedCheck={baseline:base,observation:{state,code:reason,checkedAt:Date.now()}};if(s.origin&&state==='missing')s.origin.stopped=true;return failure(reason);}finally{if(opened?.document)closeDocument(opened.document);}
 }
 function openComparedFile(document,token,parse){
  const cached=comparisons.get(document),base=target(sessions.get(document));
  if(!cached||cached.token!==token||cached.revision!==document.revision||base?.filePath!==cached.filePath)return failure('comparison-stale');
  comparisons.delete(document); // Single-use; refresh after any uncertain/changed outcome.
  try{const current=store.read(cached.filePath);
   if(current.sha256!==cached.sha256||!same(current.identity,cached.identity))return failure('comparison-stale');
   return openSnapshot(current,{parse});
  }catch(e){return failure(code(e));}
 }
 function locateLinkedFile(document){
  const base=target(sessions.get(document));if(!base)return failure('linked-file-unavailable');
  // Reveal only a freshly verified regular file at the already authorized path.
  try{return {ok:true,filePath:store.read(base.filePath).filePath};}catch(e){return failure(code(e));}
 }
 return {getLinkedFile,inspectLinkedFile,openLinkedFile,locateLinkedFile,navigationRecord,matchesLinkedFile,compareLinkedFile,openComparedFile};
}
module.exports={createLinkedFileAccess};
