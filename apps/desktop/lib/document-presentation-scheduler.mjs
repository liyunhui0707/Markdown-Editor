// Only ordinary optimistic presentation may wait for one frame. Editing proofs,
// IPC pumping, composition, pressure/recovery and settled receipts never wait.
export function createPresentationScheduler({render,fast,schedule=requestAnimationFrame,cancel=cancelAnimationFrame}){
 let frame=null,latest=null;
 function clear(){if(frame!==null)cancel(frame);frame=null;latest=null;}
 function update(state){
  if(state.pending&&!state.locked&&!state.composing&&!state.compositionInvalid&&!state.historyPending&&!state.recoveryRecords.length){
   latest=state;fast(state);
   if(frame===null)frame=schedule(()=>{const current=latest;frame=null;latest=null;if(current)render(current);});
  }else{clear();render(state);}
 }
 return {update,clear};
}
