// Navigation can retain an explicitly paused queue after all accepted edits are
// confirmed. This never permits Save, Close, unknown sync or automatic resume.
export function canNavigatePaused(s){return s?.inputPaused===true&&s.syncLocked===false&&!s.pending&&!s.historyPending
 &&s.source===s.confirmed?.source&&s.recoveryRecords?.length>0&&s.recoveryRecords.every(r=>r.reason==='edit-queue-full');}
// One explicit user action may wait for existing edits. This grants no file or
// composition authority and never replays a request after an uncertain outcome.
export function createActionIntent({context,changed=()=>{},report=()=>{},timeoutMs=5000}){
 let waiting=false;
 const unsafe=(c,navigation=false)=>c.invalid||c.loading||c.nativeComposing||c.state?.composing||c.state?.compositionInvalid
   ||c.state?.historyPending||((c.state?.locked||c.state?.recoveryRecords?.length)&&!(navigation&&canNavigatePaused(c.state)));
 async function run(label,action,{navigation=false}={}){
  const before=context();if(waiting||unsafe(before,navigation)){
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
   if(now.controller!==controller||unsafe(now,navigation)||now.state?.source!==source
       ||(controller&&(now.state.pending||now.state.source!==now.state.confirmed.source)))return false;
   return await action();
  }finally{clearTimeout(timer);abort.abort();waiting=false;changed();}
 }
 return {run,waiting:()=>waiting};
}
