'use strict';
// Production helper only. Test checkpoints are never compiled into app resources.
const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
if(process.platform!=='darwin')throw Error('Native save helper requires macOS');
const root=path.resolve(__dirname,'..'),output=path.join(root,'build','document-save');
fs.mkdirSync(path.dirname(output),{recursive:true});
const r=spawnSync('/usr/bin/xcrun',['clang','-arch','arm64','-arch','x86_64','-mmacosx-version-min=12.0','-fobjc-arc','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-framework','Foundation','-o',output,path.join(root,'native/document-save.m')],{stdio:'inherit'});
if(r.error||r.status!==0)process.exit(1);
console.log('Built production document-save helper (arm64 + x86_64).');
