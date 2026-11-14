// Comparison is read-only. Main owns the pinned disk token and all new bindings.
export function createFileComparisonView({api,byId,context,busy,rerender,open,focus}){
 const dialog=byId('file-comparison-dialog');let captured=null,running=false;
 const current=()=>{const c=context(),s=c.controller?.state();return {c,s,blocked:!s?.confirmed.linkedFile||c.loading||c.invalid||s.locked||s.pending||s.historyPending||s.composing||s.compositionInvalid||s.recoveryRecords.length||s.source!==s.confirmed.source};};
 function buttons(){const {s,blocked}=current();byId('compare-linked-file').disabled=!!blocked;
  byId('refresh-file-comparison').disabled=running||blocked;
  byId('edit-compared-file').disabled=running||blocked||!captured;
  byId('export-compared-current').disabled=running||blocked||!s?.confirmed.temporary||byId('create-test-copy').disabled;
  byId('close-file-comparison').disabled=running;
 }
 function close(){if(running)return;const owner=captured?.sessionId;captured=null;byId('comparison-current').value='';byId('comparison-disk').value='';byId('comparison-status').textContent='';dialog.close();if(owner===context().selected)focus();}
 async function compare(){
  const {c,s,blocked}=current();if(running||blocked)return;
  running=true;busy(true);captured=null;buttons();rerender();
  if(!dialog.open)dialog.showModal();byId('comparison-status').textContent='正在读取并核对磁盘版本…';
  byId('comparison-current').value=s.confirmed.source;byId('comparison-disk').value='';
  try{
   const r=await api.compareLinkedFile({sessionId:c.selected,expectedRevision:s.confirmed.revision});
   if(context().controller!==c.controller||context().selected!==c.selected)throw Error('Changed owner');
   if(!r?.snapshot||r.snapshot.sessionId!==c.selected||r.snapshot.revision!==s.confirmed.revision||r.snapshot.source!==s.confirmed.source)throw Error('Unconfirmed comparison');
   c.controller.refresh(r);
   if(!r.ok){byId('comparison-status').textContent='无法读取可核对的磁盘版本，当前文档与历史保留。请检查文件，或另存当前写作。';return;}
   captured={sessionId:c.selected,expectedRevision:s.confirmed.revision,comparisonToken:r.comparison.token,source:r.comparison.source};
   byId('comparison-disk').value=r.comparison.source;
   byId('comparison-status').textContent=`${r.comparison.label} · ${s.confirmed.source===r.comparison.source?'两份正文相同；文件身份或元数据仍可能不同。':'两份正文不同，当前修改尚未被替换。'} 本次读取于 ${new Date(r.comparison.checkedAt).toLocaleTimeString()}，不是实时监测。`;
  }catch{byId('comparison-status').textContent='核对结果尚未确认。请保留当前文档，不要重复操作；可退出后从草稿恢复。';}
  finally{running=false;busy(false);rerender();buttons();byId('close-file-comparison').focus();}
 }
 byId('compare-linked-file').onclick=compare;
 byId('compare-linked-file').onpointerdown=e=>{if(current().blocked)e.preventDefault();};
 byId('refresh-file-comparison').onclick=compare;
 byId('close-file-comparison').onclick=close;
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 byId('export-compared-current').onclick=()=>{if(running||current().blocked)return;close();byId('create-test-copy').click();};
 byId('edit-compared-file').onclick=async()=>{
  const {c,s,blocked}=current();if(running||blocked||!captured)return;
  if(captured.sessionId!==c.selected||captured.expectedRevision!==s.confirmed.revision){captured=null;byId('comparison-status').textContent='当前写作已变化，请重新核对。';buttons();return;}
  const request=captured;captured=null;running=true;buttons();
  try{const r=await open(request);if(r?.ok){running=false;close();focus();}else byId('comparison-status').textContent=r?.code==='comparison-stale'?'磁盘或当前写作在核对后再次变化，请重新核对。当前文档保留。':'未能打开磁盘新版，当前文档保留；请检查侧栏或重新核对。';}
  catch{byId('comparison-status').textContent='打开结果未知，请保留当前文档并检查侧栏，不要重复操作。';}
  finally{running=false;buttons();}
 };
 return {render:buttons,release(id){if(captured?.sessionId===id){captured=null;byId('comparison-current').value='';byId('comparison-disk').value='';if(dialog.open)dialog.close();}}};
}
