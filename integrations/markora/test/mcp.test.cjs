'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {serve}=require('../mcp.cjs');
const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}};
const ready={jsonrpc:'2.0',method:'notifications/initialized'};
async function exchange(messages,bridge={status:()=>({ok:true,installed:true}),openInInbox:()=>({ok:true,open_requested:true,display_verified:false}),create:a=>({ok:true,created:true,filename:a.filename})}){
 const input=new PassThrough(),output=new PassThrough();let text='';output.on('data',c=>text+=c.toString());
 const running=serve({input,output,bridge});for(const m of messages){const b=Buffer.from(JSON.stringify(m)+'\n');input.write(b.subarray(0,7));input.write(b.subarray(7));}input.end();await running;
 return text.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
}
test('stdio initialization, notification, discovery and tool call use isolated JSON lines',async()=>{
 const r=await exchange([init,ready,{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'get_editor_status',arguments:{}}}]);
 assert.deepEqual(r.map(x=>x.id),[1,2,3]);assert.equal(r[0].result.protocolVersion,'2025-11-25');
 assert.deepEqual(r[1].result.tools.map(t=>t.name),['get_editor_status','open_document','create_document']);assert.equal(r[2].result.structuredContent.installed,true);
 assert.equal(r[2].result.isError,false);assert.equal(r[1].result.tools[2].annotations.destructiveHint,false);
});
test('mutations require initialization and arguments cannot inject paths or policies',async()=>{
 let calls=0;const bridge={status:()=>({ok:true}),create:()=>{calls++;return {ok:true};}};
 const r=await exchange([{jsonrpc:'2.0',id:0,method:'tools/call',params:{name:'create_document',arguments:{filename:'a.md',markdown:'x'}}},init,ready,
  {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'create_document',arguments:{filename:'a.md',markdown:'x',path:'/elsewhere'}}},
  {jsonrpc:'2.0',method:'tools/call',params:{name:'create_document',arguments:{filename:'a.md',markdown:'x'}}}],bridge);
 assert.equal(calls,0);assert.equal(r[0].error.code,-32002);assert.equal(r.at(-1).error.code,-32602);
});
test('tool failures remain structured errors; missing tools are protocol errors',async()=>{
 const e=Object.assign(Error('kept'),{code:'already-exists',details:{created:false}});
 const r=await exchange([init,ready,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'create_document',arguments:{filename:'a.md',markdown:'x'}}},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'execute_shell',arguments:{}}}],{create:()=>{throw e;}});
 assert.equal(r[1].result.isError,true);assert.equal(r[1].result.structuredContent.code,'already-exists');assert.equal(r[2].error.code,-32602);
});
test('unsupported client versions negotiate a supported legacy protocol without inventing modern support',async()=>{
 const r=await exchange([{...init,params:{...init.params,protocolVersion:'unknown-future-version'}}]);assert.equal(r[0].result.protocolVersion,'2025-11-25');
});
test('split UTF-8 Chinese content is preserved and shell-looking text stays data',async()=>{
 const input=new PassThrough(),output=new PassThrough();let text='',actual;output.on('data',c=>text+=c);
 const running=serve({input,output,bridge:{create:a=>{actual=a.markdown;return {ok:true};}}});
 const body='中文 🌿 `$(not-a-command)`';const data=Buffer.from([init,ready,{jsonrpc:'2.0',id:'create',method:'tools/call',params:{name:'create_document',arguments:{filename:'中文.md',markdown:body}}}].map(x=>JSON.stringify(x)+'\n').join(''));
 for(let i=0;i<data.length;i++)input.write(data.subarray(i,i+1));input.end();await running;
 assert.equal(actual,body);assert.equal(JSON.parse(text.trim().split('\n').at(-1)).id,'create');
});
test('malformed JSON, missing newline and invalid UTF-8 produce protocol errors',async()=>{
 for(const data of [Buffer.from('{broken}\n'),Buffer.from('{"jsonrpc":"2.0","id":1}'),Buffer.from([0xff,0x0a])]){
  const input=new PassThrough(),output=new PassThrough();let text='';output.on('data',c=>text+=c);
  const running=serve({input,output,bridge:{}});input.end(data);await running.catch(()=>{});
  assert.equal(JSON.parse(text.trim()).error.code,-32700);
 }
});
