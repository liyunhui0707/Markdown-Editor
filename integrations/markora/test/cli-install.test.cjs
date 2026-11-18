'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {build}=require('../install.cjs');
test('builds a relocatable, dependency-free companion with the shared capacity rules',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mdapp-build-'))),dest=path.join(root,'installed');
 const r=build(dest,{app:'/Synthetic/Markdown.app',inbox:path.join(root,'Inbox')});
 const copied=require(path.join(dest,'document-capacity.cjs')),shared=require('../../../apps/desktop/lib/document-capacity');
 assert.equal(Object.keys(r.files).length,7);for(const [key,value]of Object.entries(shared))if(typeof value!=='function')assert.equal(copied[key],value);
 assert.equal(copied.base64Limit(4),shared.base64Limit(4));
 const run=args=>spawnSync(process.execPath,[path.join(dest,'cli.cjs'),...args],{cwd:root,encoding:'utf8',timeout:5000});
 const help=run(['help']);assert.equal(help.status,0);assert.match(help.stdout,/markora create/);assert.match(help.stdout,/mdapp/);assert.equal(help.stderr,'');
 const bad=run(['create','--name','x.md','--overwrite']);assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stderr).code,'invalid-options');
 const mcp=spawnSync(process.execPath,[path.join(dest,'cli.cjs'),'mcp'],{cwd:root,encoding:'utf8',timeout:5000,input:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'process-smoke',version:'1'}}})+'\n'});
 assert.equal(mcp.status,0);assert.equal(mcp.stderr,'');assert.equal(JSON.parse(mcp.stdout).result.serverInfo.name,'markora');
 assert.throws(()=>build(dest,{app:'other',inbox:'other'}));assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'config.json'),'utf8')).app,'/Synthetic/Markdown.app');
});
test('actual standalone CLI preserves a stdin BOM/CRLF and refuses malformed UTF-8',t=>{
 const inbox=fs.realpathSync(fs.mkdtempSync(path.join(__dirname,'mdapp-cli-fixture-')));fs.chmodSync(inbox,0o700);
 const identity=fs.statSync(inbox),temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mdapp-cli-process-')));
 t.after(()=>{const s=fs.lstatSync(inbox);assert.equal(s.ino,identity.ino);assert.equal(s.dev,identity.dev);fs.renameSync(inbox,path.join(temporary,'retained-Inbox'));});
 const dest=path.join(temporary,'installed');build(dest,{app:'/Synthetic/Markdown.app',inbox});
 const invoke=(name,input)=>spawnSync(process.execPath,[path.join(dest,'cli.cjs'),'create','--name',name,'--stdin','--no-open'],{cwd:temporary,input,encoding:'utf8',timeout:5000});
 const bytes=Buffer.from('\ufeff# 中文 🌿\r\n\r\nBody.\r\n'),r=invoke('bom.md',bytes);
 assert.equal(r.status,0,r.stderr);assert.deepEqual(fs.readFileSync(path.join(inbox,'bom.md')),bytes);
 const bad=invoke('bad.md',Buffer.from([0xff]));assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stderr).code,'invalid-markdown');assert.equal(fs.existsSync(path.join(inbox,'bad.md')),false);
});
