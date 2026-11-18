'use strict';
const {once}=require('node:events');
const {BridgeError,MAX_DOCUMENT_BYTES}=require('./bridge.cjs');
const version=require('./package.json').version;
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const nameSchema={type:'string',description:'固定 Inbox 内的 Markdown 文件名，不能包含目录或隐藏名称。',maxLength:240};
const tools=[
 {name:'get_editor_status',description:'查询已安装 Markora App 的版本、进程状态与固定生成目录；不读取打开文档的正文。',inputSchema:schema({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'open_document',description:'将固定 Inbox 内明确指定的 .md 交给 Markora App。返回打开请求已提交，不代表正文已显示或保存。',inputSchema:schema({filename:nameSchema},['filename']),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'create_document',description:'独占创建新的 UTF-8 Markdown，默认立即交给 App 显示。已有文件绝不覆盖。打开失败时保留新文件，并返回路径；不要重试创建，可调用 open_document。',inputSchema:schema({filename:nameSchema,markdown:{type:'string',maxLength:524289},open:{type:'boolean',default:true}},['filename','markdown']),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},
];
const protocolVersions=['2024-11-05','2025-03-26','2025-06-18','2025-11-25'];
function validateArguments(tool,args){
 const s=tool.inputSchema;
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(s.properties,k))||s.required.some(k=>!Object.hasOwn(args,k)))return false;
 return Object.entries(args).every(([k,v])=>typeof v===s.properties[k].type);
}
async function serve({input=process.stdin,output=process.stdout,bridge}){
 let initialized=false,ready=false,buffer='';const decoder=new TextDecoder('utf-8',{fatal:true});
 async function send(value){if(!output.write(JSON.stringify(value)+'\n'))await once(output,'drain');}
 async function receive(text){
  let m;try{m=JSON.parse(text);}catch{await send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return;}
  const validId=m&&((typeof m.id==='string'&&m.id.length<=128)||Number.isSafeInteger(m.id));
  const id=validId?m.id:null,error=(code,message)=>({jsonrpc:'2.0',id,error:{code,message}}),result=value=>({jsonrpc:'2.0',id,result:value});
  if(!m||Array.isArray(m)||m.jsonrpc!=='2.0'||typeof m.method!=='string'||(Object.hasOwn(m,'id')&&!validId)){await send(error(-32600,'Invalid request'));return;}
  if(!Object.hasOwn(m,'id')){if(m.method==='notifications/initialized'&&initialized)ready=true;return;}
  if(m.method==='ping'){await send(result({}));return;}
  if(m.method==='initialize'){
   if(initialized||!m.params||typeof m.params.protocolVersion!=='string'||!m.params.clientInfo||typeof m.params.clientInfo.name!=='string'||typeof m.params.clientInfo.version!=='string'||!m.params.capabilities||typeof m.params.capabilities!=='object'||Array.isArray(m.params.capabilities)){await send(error(-32602,'Invalid initialization'));return;}
   initialized=true;await send(result({protocolVersion:protocolVersions.includes(m.params.protocolVersion)?m.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'markora',version},instructions:'Create/open only explicit files in the configured Inbox. OS open acceptance is not a displayed-document or save receipt. Existing input and unsaved documents remain protected by the App.'}));return;
  }
  if(!ready){await send(error(-32002,'Initialize and send notifications/initialized first'));return;}
  if(m.method==='tools/list'){
   if(m.params&&Object.keys(m.params).some(k=>k!=='_meta')){await send(error(-32602,'This tool list has no additional pages'));return;}
   await send(result({tools}));return;
  }
  if(m.method!=='tools/call'){await send(error(-32601,'Method not found'));return;}
  const tool=tools.find(t=>t.name===m.params?.name),args=m.params?.arguments??{};
  if(!tool||!validateArguments(tool,args)){await send(error(-32602,'Unknown tool or invalid arguments'));return;}
  let value,isError=false;
  try{value=tool.name==='get_editor_status'?bridge.status():tool.name==='open_document'?bridge.openInInbox(args):bridge.create(args);}
  catch(e){isError=true;value={ok:false,code:e.code||'operation-failed',message:e.code?e.message:'Operation failed',...(e.details||{})};}
  await send(result({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError}));
 }
 try{
  for await(const chunk of input){buffer+=decoder.decode(chunk,{stream:true});
   let end;
   while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);if(Buffer.byteLength(line)>2*MAX_DOCUMENT_BYTES)throw new BridgeError('message-too-large');buffer=buffer.slice(end+1);if(line.trim())await receive(line);}
   if(Buffer.byteLength(buffer)>2*MAX_DOCUMENT_BYTES)throw new BridgeError('message-too-large');
  }
  buffer+=decoder.decode();if(buffer.trim())await send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Messages must end with a newline'}});
 }catch(e){await send({jsonrpc:'2.0',id:null,error:{code:-32700,message:e.code==='message-too-large'?'Message too large':'Invalid or interrupted transport'}});throw e;}
}
module.exports={serve,tools};
