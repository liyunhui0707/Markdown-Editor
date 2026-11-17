// One explicit user action may wait for existing edits. This grants no file or
// composition authority and never replays a request after an uncertain outcome.
export function createActionIntent({context,changed=()=>{},report=()=>{},timeoutMs=5000}){
 let waiting=false;
 const unsafe=c=>c.invalid||c.loading||c.nativeComposing||c.state?.composing||c.state?.compositionInvalid
   ||c.state?.locked||c.state?.historyPending||c.state?.recoveryRecords?.length;
 async function run(label,action){
  const before=context();if(waiting||unsafe(before)){
   if(before.nativeComposing||before.state?.composing)report(`请先完成当前选词，再${label}。`);
   return false;
  }
  report('');
  const controller=before.controller,source=before.state?.source,abort=new AbortController();let timer,expired=false;
  waiting=true;changed();
  try{
   if(controller)await Promise.race([controller.idle({signal:abort.signal}),new Promise(resolve=>{timer=setTimeout(()=>{expired=true;resolve();},timeoutMs);})]);
   if(expired){report(`输入确认耗时较长，尚未执行${label}。请稍后重试；当前内容保留。`);return false;}
   const now=context();
   if(now.controller!==controller||unsafe(now)||now.state?.source!==source
       ||(controller&&(now.state.pending||now.state.source!==now.state.confirmed.source)))return false;
   return await action();
  }finally{clearTimeout(timer);abort.abort();waiting=false;changed();}
 }
 return {run,waiting:()=>waiting};
}
