'use strict';
// Only the ElectronApplication returned by this test's _electron.launch. Never
// look up global PIDs or affect the installed app. Failed synthetic data stays.
async function stopOwnedElectron({app,exit,timeoutMs=10000}){
 const child=app.process();if(!Number.isSafeInteger(child?.pid)||child.pid<1)throw Error('Owned test process required');
 async function bounded(promise){
  let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);}
  finally{clearTimeout(timer);}
 }
 const close=Promise.resolve().then(()=>app.close()).then(()=>exit).catch(()=>null);
 const normal=await bounded(close);if(normal)return {...normal,forced:false};
 child.kill('SIGTERM');let result=await bounded(exit);
 if(!result){child.kill('SIGKILL');result=await bounded(exit);}
 if(!result)throw Error('Owned test process did not terminate; evidence retained');
 return {...result,forced:true};
}
module.exports={stopOwnedElectron};
