'use strict';
// Read-only gate for an already signed AND stapled Document app. Does not upload or sign.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const asar=require('@electron/asar');
function checked(command,args){
 const r=spawnSync(command,args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 if(r.error||r.status!==0)throw Error(`${path.basename(command)} verification failed; inspect this candidate before distribution.`);
 return r.stdout+r.stderr;
}
function signed(metadata,team,label){
 if(!/^Authority=Developer ID Application: .+$/m.test(metadata)
    ||!metadata.split(/\r?\n/).includes('TeamIdentifier='+team)
    ||!/^CodeDirectory .*flags=.*\bruntime\b/m.test(metadata)
    ||!/^Timestamp=.+$/m.test(metadata))throw Error(`${label}: expected timestamped Developer ID signature, matching team and Hardened Runtime.`);
}
function verifyDocumentRelease(appPath,team,{run=checked}={}){
 if(!path.isAbsolute(appPath)||path.extname(appPath)!=='.app'||!fs.lstatSync(appPath).isDirectory()||fs.lstatSync(appPath).isSymbolicLink())throw Error('Supply an absolute, non-symlink .app directory.');
 if(!/^[A-Z0-9]{10}$/.test(team))throw Error('Supply the expected 10-character Apple Team ID.');
 const contents=path.join(appPath,'Contents'),helper=path.join(contents,'Resources/document-save');
 for(const f of ['Info.plist','Resources/app.asar','Resources/document-save']){
  const s=fs.lstatSync(path.join(contents,f));if(!s.isFile()||s.isSymbolicLink())throw Error('Invalid bundle resource: '+f);
 }
 const plist=JSON.parse(run('/usr/bin/plutil',['-convert','json','-o','-',path.join(contents,'Info.plist')]));
 const pkg=JSON.parse(asar.extractFile(path.join(contents,'Resources/app.asar'),'package.json'));
 const expected=require('../package.json').version,id=require('../electron-builder.document.cjs').appId;
 if(plist.CFBundleIdentifier!==id||plist.CFBundleShortVersionString!==expected||pkg.version!==expected||pkg.main!=='document-app-main.js')throw Error('App identity, entry or version does not match this checkout.');
 run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',appPath]);
 signed(run('/usr/bin/codesign',['--display','--verbose=4',appPath]),team,'App');
 run('/usr/bin/codesign',['--verify','--strict','--verbose=2',helper]);
 signed(run('/usr/bin/codesign',['--display','--verbose=4',helper]),team,'Save helper');
 run('/usr/bin/xcrun',['stapler','validate',appPath]);
 run('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',appPath]);
 return {ok:true,version:expected,bundleId:id,teamId:team,signature:'Developer ID Application',stapled:true,gatekeeper:'accepted',
  scope:'signature/notarization gate only; real input, accessibility, package contents and installation acceptance remain separate'};
}
module.exports={verifyDocumentRelease};
if(require.main===module){
 try{if(process.argv.length!==4)throw Error('Usage: node tools/verify-document-release.cjs /absolute/Markdown.app TEAMID');
  console.log(JSON.stringify(verifyDocumentRelease(process.argv[2],process.argv[3]),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
