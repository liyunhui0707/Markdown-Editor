'use strict';
// Test evidence only. No product hooks, cache purging or background-throttling changes.
function rendererFrames() {
 return new Promise((resolve,reject)=>{
  const frames=[];let frameCallbacks=0,settled=false;
  const timer=setTimeout(()=>{settled=true;reject(Error('Resource sample needs two distinct frame timestamps: '+JSON.stringify({frames,frameCallbacks})));},5000);
  function next(time){
   if(settled)return;frameCallbacks++;
   // Consecutive callbacks can share a timestamp on macOS. Wait for progress,
   // rather than treating that scheduling condition as invalid memory evidence.
   if(Number.isFinite(time)&&(!frames.length||time>frames[0]))frames.push(time);
   if(frames.length===2){settled=true;clearTimeout(timer);resolve({visibility:document.visibilityState,hidden:document.hidden,frames,frameCallbacks});}
   else requestAnimationFrame(next);
  }
  requestAnimationFrame(next);
 });
}
function createResourceProbe({app,page,cdp}) {
 async function observe() {
  const presentation=await page.evaluate(rendererFrames);
  const host=await app.evaluate(({app,BrowserWindow})=>{
   const windows=BrowserWindow.getAllWindows();if(windows.length!==1)throw Error('One isolated resource window required');
   const window=windows[0];return {window:{visible:window.isVisible(),minimized:window.isMinimized(),rendererPid:window.webContents.getOSProcessId()},
    main:process.getHeapStatistics(),processes:app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,memory:m.memory}))};
  });
  // Electron can report document.visibilityState='visible' for a hidden native
  // window. Check both, rather than measuring unpresented event/paint queues.
  if(!host.window.visible||host.window.minimized||presentation.visibility!=='visible'||presentation.hidden
      ||presentation.frames.length!==2||!presentation.frames.every(Number.isFinite)||presentation.frames[1]<=presentation.frames[0])
   throw Error('Resource sample requires a visible native window and two renderer frames: '+JSON.stringify({presentation,nativeWindow:host.window}));
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
module.exports={createResourceProbe,rendererFrames};
