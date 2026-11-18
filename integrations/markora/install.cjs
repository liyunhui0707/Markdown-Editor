#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {createBridge}=require('./bridge.cjs');
const version=require('./package.json').version;
const sha=b=>createHash('sha256').update(b).digest('hex');
function build(destination,config){
 if(fs.existsSync(destination))throw Error('Destination already exists; no files were overwritten');
 fs.mkdirSync(destination,{mode:0o700});const hashes={};
 const files=['bridge.cjs','cli.cjs','mcp.cjs','package.json'];
 for(const name of [...files,'document-capacity.cjs','LICENSE']){
  const source=name==='document-capacity.cjs'?path.resolve(__dirname,'../../apps/desktop/lib/document-capacity.js'):name==='LICENSE'?path.resolve(__dirname,'../../LICENSE'):path.join(__dirname,name);
  const s=fs.lstatSync(source);if(!s.isFile()||s.isSymbolicLink())throw Error('Unexpected source file');
  const bytes=fs.readFileSync(source);fs.writeFileSync(path.join(destination,name),bytes,{flag:'wx',mode:0o600});hashes[name]=sha(bytes);
 }
 const bytes=Buffer.from(JSON.stringify({app:config.app,inbox:config.inbox},null,2)+'\n');fs.writeFileSync(path.join(destination,'config.json'),bytes,{flag:'wx',mode:0o600});hashes['config.json']=sha(bytes);
 fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({version,files:hashes},null,2)+'\n',{flag:'wx',mode:0o600});
 for(const [n,h]of Object.entries(hashes))if(sha(fs.readFileSync(path.join(destination,n)))!==h)throw Error('Copy verification failed');
 return {version,directory:destination,files:hashes};
}
function ownedDirectory(home,target){
 const rel=path.relative(home,target);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('User-local destination required');let p=home;
 for(const part of rel.split(path.sep)){p=path.join(p,part);if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o022))throw Error('Unsafe installation directory');}
}
function install(){
 if(process.argv.length!==2||process.platform!=='darwin'||Number(process.versions.node.split('.')[0])<24)throw Error('Run with Node 24+ on macOS, without arguments');
 const home=fs.realpathSync(os.homedir()),config={home,app:path.join(home,'Applications/Markora.app'),inbox:path.join(home,'Liyunhui/Inbox')};
 const info=createBridge(config).status();if(!info.installed||!info.creation_available)throw Error('Installed Markora App and an owned ordinary Inbox are required');
 const base=path.join(home,'.local/share/markora'),bin=path.join(home,'.local/bin'),shim=path.join(bin,'markora'),destination=path.join(base,version);
 if(fs.existsSync(shim)||fs.existsSync(destination))throw Error('Existing Markora installation retained; inspect it before updating');
 ownedDirectory(home,base);ownedDirectory(home,bin);const receipt=build(destination,config);
 const q=s=>"'"+s.replace(/'/g,"'\"'\"'")+"'";
 const script='#!/bin/sh\nexec '+q(process.execPath)+' '+q(path.join(destination,'cli.cjs'))+' "$@"\n';
 fs.writeFileSync(shim,script,{flag:'wx',mode:0o755});
 console.log(JSON.stringify({...receipt,command:shim,node:process.execPath,app:config.app,inbox:config.inbox,pathConfigured:process.env.PATH.split(path.delimiter).includes(bin),restore:'No existing command or application was replaced. Retain this directory and shim for a recoverable uninstall.'}));
}
if(require.main===module)try{install();}catch(e){console.error(JSON.stringify({ok:false,message:e.message}));process.exitCode=1;}
module.exports={build};
