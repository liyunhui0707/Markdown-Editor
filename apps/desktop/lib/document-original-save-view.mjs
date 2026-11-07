// Save authority stays in main. This view only selects the current bound session.
export function originalSaveRefusal(s, c = {}) {
  const o=s?.confirmed?.originalSave;
  if(!o?.available)return 'unavailable';
  if(o.stopped)return 'unresolved-save-state';
  if(c.loading||c.invalid||s.locked||s.confirmed.blocked||s.pending||s.historyPending||s.composing||s.compositionInvalid||s.recoveryRecords.length||s.source!==s.confirmed.source)return 'input-not-ready';
  return null;
}
export function createOriginalSaveView({api,byId,context,busy,rerender,focus}) {
  const notices=new Map(),unknown=new Set();let listing=false;
  const doc=byId('save-original').ownerDocument;
  function render(s){
    const c=context(),o=s.confirmed.originalSave,button=byId('save-original');
    button.hidden=!o?.available;button.disabled=!!originalSaveRefusal(s,c)||unknown.has(c.selected);
    button.title=o?.filePath?`保存回 ${o.filePath}（⌘S）`:'';
    const history=byId('original-save-receipt'),last=o?.lastConfirmed;history.hidden=!last;history.textContent=last?`最后确认保存 · 修订 ${last.revision}\n${last.filePath}\nSHA-256: ${last.sha256}`:'';
    const alert=byId('original-save-status');alert.replaceChildren();alert.hidden=!o;
    if(!o)return;
    const r=o.receipt;
    if(last){const text=doc.createElement('p');text.textContent=`已保存回 ${last.filePath.split('/').pop()} · ${s.confirmed.dirty?'之后的修改尚未保存':'当前正文已保存'}。`;alert.append(text);}
    const message=notices.get(c.selected)||(r?.ok===false?(r.committed===false?'未保存回原文件。请保留草稿，重新打开原文件核对，或另存新文件。':'本次保存未确认，原路径可能已经更新。各版本已保留，请检查恢复材料；不会自动重试或回退。'):'');
    if(message){const text=doc.createElement('p');text.textContent=message+(r?.code?`（${r.code}）`:'');alert.append(text);}
    if(r?.recordId){const reveal=doc.createElement('button');reveal.type='button';reveal.textContent='查看保存版本';reveal.disabled=!!c.loading;reveal.onclick=()=>api.revealSaveRecovery(r.recordId);alert.append(reveal);}
    alert.hidden=!alert.childNodes.length;alert.dataset.tone=message?'error':'success';
  }
  async function save(){
    const c=context(),s=c.controller?.state();if(originalSaveRefusal(s,c)||unknown.has(c.selected))return;
    const revision=s.confirmed.revision,source=s.source;notices.delete(c.selected);busy(true);rerender();
    try{
      const r=await api.saveOriginal({sessionId:c.selected,expectedRevision:revision}),now=context();
      if(now.controller!==c.controller||now.selected!==c.selected||r?.snapshot?.sessionId!==c.selected||r.snapshot.revision!==revision||r.snapshot.source!==source||(r.ok&&(r.snapshot.originalSave?.receipt?.revision!==revision||r.snapshot.originalSave?.receipt?.sha256!==s.confirmed.copySha256||r.snapshot.originalSave?.filePath!==s.confirmed.originalSave.filePath))){unknown.add(c.selected);notices.set(c.selected,'保存结果未知，请保留当前草稿，并查看“草稿”中的保存版本。');}
      else{c.controller.refresh(r);if(!r.ok&&!r.snapshot.originalSave?.receipt)notices.set(c.selected,r.code==='save-cancelled'?'已取消保存。':`暂未保存（${r.code}），当前草稿保留。`);}
    }catch{unknown.add(c.selected);notices.set(c.selected,'保存结果未知，请保留当前草稿，并检查保存版本。');}
    finally{busy(false);rerender();focus();}
  }
  async function refresh(){
    if(listing)return;listing=true;const host=byId('save-version-list');host.textContent='正在读取保存记录…';
    try{const r=await api.listSaveRecoveries();host.replaceChildren();
      if(!r?.ok){host.textContent='保存版本暂不可用。';return;}
      if(!r.records.length)host.textContent='尚无保存回原文件的记录。';
      for(const record of r.records){const row=doc.createElement('div'),text=doc.createElement('p'),button=doc.createElement('button');row.className='save-version-row';
        const state=record.state==='saved-confirmed'?'已确认':record.state==='not-saved'?'未写回':'需要检查';
        text.textContent=`${record.label} · ${state} · ${record.time?new Date(record.time).toLocaleString():'时间未知'}`;button.type='button';button.textContent='在 Finder 查看';
        button.onclick=async()=>{const result=await api.revealSaveRecovery(record.id);if(!result?.ok)text.textContent+=' · 无法定位，记录保留。';};row.append(text,button);host.append(row);
      }
    }catch{host.textContent='无法读取保存记录，现有材料保留。';}finally{listing=false;}
  }
  byId('save-original').onpointerdown=e=>{if(originalSaveRefusal(context().controller?.state(),context()))e.preventDefault();};
  byId('save-original').onclick=save;byId('refresh-save-versions').onclick=refresh;
  byId('show-drafts').addEventListener('click',refresh);
  return {render,save};
}
