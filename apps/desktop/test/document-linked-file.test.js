const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDocumentService}=require('../lib/document-service');
const {createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'document-linked-'))),file=path.join(root,'原文.md'),bytes=Buffer.from('\ufeff# First\r\n\r\nText\r');fs.writeFileSync(file,bytes,{mode:0o600});
 const service=createDocumentService(),original=service.open(file).document;
 return {root,file,bytes,service,original};
}
test('read-only linked inspection and fresh disk open retain original bytes and grant no write',()=>{
 const f=fixture();assert.equal(f.service.getLinkedFile(f.original).baselineSha256,hash(f.bytes));assert.equal(f.service.inspectLinkedFile(f.original).ok,true);
 assert.equal(f.service.getLinkedFile(f.original).checked.state,'unchanged');
 const bytes=Buffer.from('# External\n\nNew version');fs.writeFileSync(f.file,bytes);
 assert.equal(f.service.inspectLinkedFile(f.original).ok,true);assert.equal(f.service.getLinkedFile(f.original).checked.state,'changed');
 const opened=f.service.openLinkedFile(f.original);assert(opened.ok);assert.equal(opened.document.text,bytes.toString());assert.deepEqual(f.original.originalBytes,f.bytes);
 assert.equal(f.service.getOriginalState(opened.document),null);assert.equal(f.service.getSaveState(f.original).state,'not-submitted');
 assert.deepEqual(fs.readFileSync(f.file),bytes);assert(f.service.close(opened.document).ok);
});
test('missing, replaced symlink, unsupported encoding and closed capability never overwrite or expose new paths',()=>{
 const f=fixture();fs.renameSync(f.file,f.file+'.retained');assert(f.service.inspectLinkedFile(f.original).ok);assert.equal(f.service.getLinkedFile(f.original).checked.state,'missing');assert.equal(f.service.openLinkedFile(f.original).code,'file-unavailable');
 fs.symlinkSync(f.file+'.retained',f.file);assert(f.service.inspectLinkedFile(f.original).ok);assert.equal(f.service.getLinkedFile(f.original).checked.state,'unavailable');assert.equal(f.service.openLinkedFile(f.original).code,'unsupported-file');
 const g=fixture();fs.writeFileSync(g.file,Buffer.from([0xff]));assert.equal(g.service.openLinkedFile(g.original).code,'unsupported-encoding');
 f.service.close(f.original);assert.equal(f.service.getLinkedFile(f.original),null);assert.equal(f.service.inspectLinkedFile(f.original).code,'linked-file-unavailable');
});
