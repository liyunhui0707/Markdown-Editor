'use strict';
const same=require('node:util').isDeepStrictEqual;
const {failure}=require('./document-contract');
// Main-only read capability derived from an already opened/bound document.
// Observations never rebase the draft, clear a stopped save or restore write authority.
function createLinkedFileAccess({store,sessions,openSnapshot}) {
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
 function locateLinkedFile(document){
  const base=target(sessions.get(document));if(!base)return failure('linked-file-unavailable');
  // Reveal only a freshly verified regular file at the already authorized path.
  try{return {ok:true,filePath:store.read(base.filePath).filePath};}catch(e){return failure(code(e));}
 }
 return {getLinkedFile,inspectLinkedFile,openLinkedFile,locateLinkedFile};
}
module.exports={createLinkedFileAccess};
