import {originalSaveNotice} from './document-file-presentation.mjs';
// Save authority stays in main. This view only selects the current bound session.
export function originalSaveRefusal(s, c = {}) {
  const o=s?.confirmed?.originalSave;
  if(!o?.available)return 'unavailable';
  if(o.stopped)return 'unresolved-save-state';
  if(c.loading||c.invalid||s.locked||s.confirmed.blocked||s.pending||s.historyPending||s.composing||s.compositionInvalid||s.recoveryRecords.length||s.source!==s.confirmed.source)return 'input-not-ready';
  return null;
}
export function createOriginalSaveView({api,byId,context,busy,rerender,focus}) {
  const notices=new Map(),unknown=new Set();let listing=false,managementNotice='';
  const doc=byId('save-original').ownerDocument;
  function render(s){
    const c=context(),o=s.confirmed.originalSave,button=byId('save-original');
    button.hidden=!o?.available;button.disabled=!!originalSaveRefusal(s,c)||unknown.has(c.selected);
    button.title=o?.filePath?`保存回 ${o.filePath}（⌘S）`:'';
    const history=byId('original-save-receipt'),last=o?.lastConfirmed;history.hidden=!last;history.textContent=last?`最后确认保存 · 修订 ${last.revision}\n${last.filePath}\nSHA-256: ${last.sha256}`:'';
    const alert=byId('original-save-status');alert.replaceChildren();alert.hidden=!o;
    if(!o)return;
    const r=o.receipt;
    if(last){const text=doc.createElement('p');text.textContent=`已保存回 ${last.filePath.split('/').pop()} · ${o.stopped?'当前文件状态需核对':s.confirmed.dirty?'之后的修改尚未保存':'当前正文已保存'}。`;alert.append(text);}
    const message=originalSaveNotice(s.confirmed)||notices.get(c.selected)||'';
    if(message){const text=doc.createElement('p');text.textContent=message+(r?.code?`（${r.code}）`:'');alert.append(text);}
    if(o.stopped&&s.confirmed.linkedFile){for(const [label,id] of [['核对两份内容','compare-linked-file'],['打开磁盘版','open-linked-file'],['另存新文件…','create-test-copy']]){const b=doc.createElement('button');b.type='button';b.textContent=label;b.disabled=!!(c.loading||c.invalid||s.locked||s.pending||s.historyPending||s.composing||s.compositionInvalid||s.recoveryRecords.length||s.source!==s.confirmed.source);b.onpointerdown=e=>byId(id).onpointerdown?.(e);b.onclick=()=>byId(id).click();alert.append(b);}}
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
      if(managementNotice){const notice=doc.createElement('p');notice.textContent=managementNotice;notice.setAttribute?.('role','status');host.append(notice);}
      const capacity=doc.createElement('p');capacity.textContent=`工作区保存版本 ${r.capacity?.records ?? r.records.length} / ${r.capacity?.maxRecords ?? 128}；恢复归档 ${r.archived?.length ?? 0} 条。归档保留材料并腾出保存名额，仍占用磁盘空间。每个文件的最新版本及不确定记录不参与整理。`+(r.archiveWarning?' 归档区暂不可用，材料保留。':'');host.append(capacity);
      if(!r.records.length)host.textContent='尚无保存回原文件的记录。';
      for(const record of [...r.records,...(r.archived||[])]){const row=doc.createElement('div'),text=doc.createElement('p'),button=doc.createElement('button');row.className='save-version-row';row.dataset.recordId=record.id;
        const state=record.archived?'恢复归档':record.state==='saved-confirmed'?'已确认':record.state==='not-saved'?'未写回':'需要检查';
        text.textContent=`${record.label} · ${state} · ${record.time?new Date(record.time).toLocaleString():'时间未知'}`;button.type='button';button.textContent='在 Finder 查看';
        button.onclick=async()=>{const result=await api.revealSaveRecovery(record.id);if(!result?.ok)text.textContent+=' · 无法定位，记录保留。';};row.append(text,button);
        if(record.manageToken&&!record.archived){const offload=doc.createElement('button');offload.type='button';offload.textContent='归档旧版本';
          offload.onclick=()=>{if(listing||context().loading)return;offload.hidden=true;
            const prompt=doc.createElement('p'),yes=doc.createElement('button'),no=doc.createElement('button');
            prompt.textContent='将整个保存版本移入恢复归档？保留所有文件及元数据，不改写 Markdown 原文件；可继续在 Finder 检查。';
            yes.type=no.type='button';yes.textContent='确认归档旧版本';no.textContent='取消';row.append(prompt,yes,no);yes.focus?.();
            no.onclick=()=>{prompt.remove();yes.remove();no.remove();offload.hidden=false;offload.focus?.();};
            yes.onclick=async()=>{if(listing||context().loading)return;listing=true;busy(true);yes.disabled=no.disabled=true;
              try{const result=await api.offloadSaveRecovery({recordId:record.id,expectedToken:record.manageToken});managementNotice=result?.ok?'已归档，保存名额已释放。':'归档未确认，材料保留；请刷新检查，不自动重试。';}
              catch{managementNotice='归档结果未知，材料保留；请刷新检查，不自动重试。';}
              finally{listing=false;busy(false);rerender();await refresh();byId('refresh-save-versions').focus?.();}
            };
          };row.append(offload);
        }host.append(row);
      }
    }catch{host.textContent='无法读取保存记录，现有材料保留。';}finally{listing=false;}
  }
  byId('save-original').onpointerdown=e=>{if(originalSaveRefusal(context().controller?.state(),context()))e.preventDefault();};
  byId('save-original').onclick=save;byId('refresh-save-versions').onclick=refresh;
  byId('show-drafts').addEventListener('click',refresh);
  return {render,save,release(sessionId){notices.delete(sessionId);unknown.delete(sessionId);}};
}
