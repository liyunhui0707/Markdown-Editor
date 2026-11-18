#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBridge,BridgeError,MAX_DOCUMENT_BYTES}=require('./bridge.cjs');
const help=`markora — Markora CLI / MCP companion
兼容命令：mdapp（相同参数与行为）

  markora status                       查询已安装 App 和固定 Inbox
  markora open /absolute/document.md    打开一个明确的 Markdown 文件
  markora create --name 文件.md --stdin  从标准输入生成新文档并显示
  markora create --name 文件.md --stdin --no-open
  markora mcp                          启动本地 stdio MCP server

全局参数（放在命令之前）：--app /path/Markora.app --inbox /existing/Inbox
已有文件不会覆盖。普通命令输出 JSON；MCP 模式只输出协议消息。
需要 Node 24+；App 本身仍可独立使用。\n`;
function parse(argv){
 let settings={};const settingsFile=path.join(__dirname,'config.json');
 if(fs.existsSync(settingsFile))settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
 const home=os.homedir(),config={home,app:settings.app||path.join(home,'Applications/Markora.app'),inbox:settings.inbox||path.join(home,'Liyunhui/Inbox')};
 while(['--app','--inbox'].includes(argv[0])){const k=argv.shift().slice(2),v=argv.shift();if(!v||!path.isAbsolute(v))throw new BridgeError('invalid-options');config[k]=v;}
 const command=argv.shift()||'help';return {config,command,args:argv};
}
async function run(argv){
 const {config,command,args}=parse([...argv]);
 if(['help','--help','-h'].includes(command)){if(args.length)throw new BridgeError('invalid-options');process.stdout.write(help);return;}
 if(command==='--version'){if(args.length)throw new BridgeError('invalid-options');console.log('markora '+require('./package.json').version);return;}
 const bridge=createBridge(config);
 if(command==='mcp'){if(args.length)throw new BridgeError('invalid-options');await require('./mcp.cjs').serve({bridge});return;}
 let result;
 if(command==='status'&&(!args.length||(args.length===1&&args[0]==='--json')))result=bridge.status();
 else if(command==='open'&&args.length===1)result=bridge.openExplicit(path.resolve(args[0]));
 else if(command==='create'){
  let name,stdin=false,open=true;
  for(let i=0;i<args.length;i++){
   if(args[i]==='--name'&&!name)name=args[++i];
   else if(args[i]==='--stdin'&&!stdin)stdin=true;
   else if(args[i]==='--no-open'&&open)open=false;
   else throw new BridgeError('invalid-options');
  }
  if(!stdin||!name)throw new BridgeError('invalid-options','create 需要 --name 和 --stdin。');
  const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>MAX_DOCUMENT_BYTES)throw new BridgeError('document-too-large');chunks.push(chunk);}
  let markdown;try{markdown=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks));}catch{throw new BridgeError('invalid-markdown');}
  result=bridge.create({filename:name,markdown,open});
 }else throw new BridgeError('invalid-options','请运行 markora help。');
 console.log(JSON.stringify(result));
}
if(require.main===module)run(process.argv.slice(2)).catch(e=>{console.error(JSON.stringify({ok:false,code:e.code||'operation-failed',message:e.code?e.message:'Operation failed',...(e.details||{})}));process.exitCode=1;});
module.exports={run,parse};
