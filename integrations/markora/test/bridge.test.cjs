'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBridge,BridgeError}=require('../bridge.cjs');
function fixture(){
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mdapp-unit-')));fs.chmodSync(home,0o700);
 const inbox=path.join(home,'Inbox');fs.mkdirSync(inbox,0o700);const opened=[];
 const host={status:()=>({installed:true,version:'0.81.0',running:true}),open:p=>opened.push(p)};
 return {home,inbox,opened,host,bridge:createBridge({home,inbox,app:'/Synthetic/Markdown.app'},host)};
}
test('creates exact Markdown exclusively and sends the same path to the app',()=>{
 const f=fixture(),body='\ufeff# 中文 🌿\r\n\r\n**bold**\r\n';const r=f.bridge.create({filename:'中文 测试.md',markdown:body});
 assert.equal(fs.readFileSync(r.file_path,'utf8'),body);assert.equal(fs.statSync(r.file_path).mode&0o777,0o600);
 assert.deepEqual(f.opened,[r.file_path]);assert.equal(r.open_requested,true);assert.equal(r.display_verified,false);
 assert.throws(()=>f.bridge.create({filename:'中文 测试.md',markdown:'replacement'}),e=>e.code==='already-exists');
 assert.equal(fs.readFileSync(r.file_path,'utf8'),body);
});
test('refuses traversal, hidden/secret paths, invalid text and capacity before writing',()=>{
 const f=fixture();for(const filename of ['../escape.md','/escape.md','.env.md','a/b.md','a\\b.md','bad\n.md','file.txt'])
  assert.throws(()=>f.bridge.create({filename,markdown:'x'}),BridgeError);
 for(const markdown of ['x\0y','\ud800','a'.repeat(524289)])assert.throws(()=>f.bridge.create({filename:'bad.md',markdown}),BridgeError);
 assert.deepEqual(fs.readdirSync(f.inbox),[]);assert.equal(f.opened.length,0);
});
test('accepts document boundary and refuses additional fields rather than guessing',()=>{
 const f=fixture();const r=f.bridge.create({filename:'limit.md',markdown:'a'.repeat(524288),open:false});
 assert.equal(fs.statSync(r.file_path).size,524288);assert.deepEqual(f.opened,[]);
 assert.throws(()=>f.bridge.create({filename:'next.md',markdown:'x',overwrite:true}),e=>e.code==='invalid-arguments');
});
test('MCP opens only an explicit filename in its pinned inbox; refuses symlinks',()=>{
 const f=fixture();fs.writeFileSync(path.join(f.inbox,'a.md'),'# a');f.bridge.openInInbox({filename:'a.md'});
 assert.deepEqual(f.opened,[path.join(f.inbox,'a.md')]);assert.throws(()=>f.bridge.openInInbox({filename:'../other.md'}),BridgeError);
 fs.symlinkSync(path.join(f.inbox,'a.md'),path.join(f.inbox,'link.md'));
 assert.throws(()=>f.bridge.openInInbox({filename:'link.md'}),e=>e.code==='unsupported-file');
});
test('pins the configured directory and refuses a replaced inbox',()=>{
 const f=fixture();f.bridge.status();fs.renameSync(f.inbox,f.inbox+'-retained');fs.mkdirSync(f.inbox,0o700);
 assert.throws(()=>f.bridge.create({filename:'a.md',markdown:'x'}),e=>e.code==='inbox-changed');
 assert.deepEqual(fs.readdirSync(f.inbox),[]);
});
test('rejects a symlink inbox and any hidden or secrets ancestor',()=>{
 const f=fixture();const alias=path.join(f.home,'alias');fs.symlinkSync(f.inbox,alias);
 const b=createBridge({home:f.home,inbox:alias,app:'app'},f.host);
 assert.throws(()=>b.create({filename:'a.md',markdown:'x'}),e=>e.code==='unsupported-inbox');
 const secret=path.join(f.home,'secrets');fs.mkdirSync(secret);const c=createBridge({home:f.home,inbox:secret,app:'app'},f.host);
 assert.throws(()=>c.create({filename:'a.md',markdown:'x'}),BridgeError);
});
test('failed app delivery retains the verified new file and reports the partial outcome',()=>{
 const f=fixture();f.host.open=()=>{throw Error('OS launch failed');};
 assert.throws(()=>f.bridge.create({filename:'retained.md',markdown:'# retained'}),e=>{
  assert.equal(e.code,'open-request-failed');assert.equal(e.details.created,true);
  assert.equal(e.details.open_requested,false);assert.equal(e.details.retry_create,false);return true;
 });assert.equal(fs.readFileSync(path.join(f.inbox,'retained.md'),'utf8'),'# retained');
});
test('an unavailable app fails before create; explicit no-open creation is available',()=>{
 const f=fixture();f.host.status=()=>({installed:false});assert.throws(()=>f.bridge.create({filename:'a.md',markdown:'x'}),e=>e.code==='app-unavailable');
 assert.deepEqual(fs.readdirSync(f.inbox),[]);f.bridge.create({filename:'a.md',markdown:'x',open:false});
});
test('a failed write confirmation retains the created file and never retries',t=>{
 const f=fixture();t.mock.method(fs,'fsyncSync',()=>{throw Error('synthetic fsync failure');});
 assert.throws(()=>f.bridge.create({filename:'uncertain.md',markdown:'# retained',open:false}),e=>e.code==='creation-unconfirmed'&&e.details.created&&e.details.retry_create===false);
 assert.equal(fs.readFileSync(path.join(f.inbox,'uncertain.md'),'utf8'),'# retained');assert.deepEqual(f.opened,[]);
});
