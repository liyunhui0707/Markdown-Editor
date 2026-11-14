'use strict';
// Test evidence only. No product hooks, cache purging or background-throttling changes.
function createResourceProbe({app,page,cdp}) {
 async function observe() {
  const presentation=await page.evaluate(()=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Resource sample needs presented renderer frames')),5000);
   requestAnimationFrame(first=>requestAnimationFrame(second=>{
    clearTimeout(timer);resolve({visibility:document.visibilityState,hidden:document.hidden,frames:[first,second]});
   }));
  }));
  const host=await app.evaluate(({app,BrowserWindow})=>{
   const windows=BrowserWindow.getAllWindows();if(windows.length!==1)throw Error('One isolated resource window required');
   const window=windows[0];return {window:{visible:window.isVisible(),minimized:window.isMinimized(),rendererPid:window.webContents.getOSProcessId()},
    main:process.getHeapStatistics(),processes:app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,memory:m.memory}))};
  });
  // Electron can report document.visibilityState='visible' for a hidden native
  // window. Check both, rather than measuring unpresented event/paint queues.
  if(!host.window.visible||host.window.minimized||presentation.visibility!=='visible'||presentation.hidden
      ||presentation.frames.length!==2||!presentation.frames.every(Number.isFinite)||presentation.frames[1]<=presentation.frames[0])
   throw Error('Resource sample requires a visible native window and two renderer frames');
  return {schema:2,observedAt:Date.now(),units:{renderer:'bytes',main:'kilobytes',processes:'kilobytes'},
   presentation:{...presentation,...host.window},renderer:await cdp.send('Runtime.getHeapUsage'),
   dom:await cdp.send('Memory.getDOMCounters'),main:host.main,processes:host.processes};
 }
 return {async sample({collect=false}={}){
  const before=await observe();if(!collect)return {...before,collected:false};
  await cdp.send('HeapProfiler.collectGarbage');
  return {...await observe(),collected:true,beforeCollection:before};
 }};
}
module.exports={createResourceProbe};
