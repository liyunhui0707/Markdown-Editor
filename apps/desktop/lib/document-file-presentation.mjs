// Display only. Exact main-owned baseline hashes distinguish file saving from backup.
export function filePresentation(current,state){
 if(!current)return {label:'未打开文档',kind:'未打开文档',location:''};
 const file=current.linkedFile,o=current.originalSave;
 if(!current.temporary)return {label:'原文只读',kind:'原文件 · 只读',location:file?.filePath||current.location||''};
 if(!file)return {label:'本地草稿',kind:'独立草稿',location:'独立草稿，尚未关联文件。'};
 const blocked=o?.stopped,known=file.checked?.state;
 const pending=state&&(state.pending||state.historyPending||state.composing||state.compositionInvalid||state.source!==current.source);
 const label=blocked?'保存已暂停':pending?'输入待确认':known==='changed'?'磁盘文件已变化':known==='missing'?'磁盘文件已移动或删除':known==='unavailable'?'磁盘文件暂不可核对'
  :typeof current.copySha256==='string'&&current.copySha256===file.baselineSha256?'正文已保存':'修改未保存';
 return {label,kind:'文件 · '+label,location:file.filePath};
}
export function linkedFileMessage(file,stopped=false){
 if(!file)return '此草稿尚未关联磁盘文件。另存新文件后可在这里核对。';
 const checked=file.checked;
 if(!checked)return '尚未检查磁盘变化。检查不会替换正文；打开磁盘版会保留当前文档。';
 const messages={unchanged:'检查时磁盘文件与已打开或上次保存的版本一致。',changed:'磁盘文件已变化。当前正文与撤销历史保留；请打开磁盘版核对，或将当前内容另存新文件。',missing:'原路径的文件已移动或删除。当前正文保留，可另存新文件；文件移回后可重新检查。',unavailable:'无法核对该文件，请检查权限与文件类型。当前正文保留。'};
 return (messages[checked.state]||'未能确认磁盘状态。')+(stopped?' 当前会话不会恢复写回；请从核对后的磁盘版创建新编辑副本，或另存新文件。':'');
}

export function originalSaveNotice(current){
 const o=current.originalSave,r=o?.receipt;
 if(r?.committed===false&&r.code==='save-recovery-capacity')return '保存版本工作区已满。请打开“草稿”，将已确认的旧保存版本移入恢复归档，再保存；当前正文保留。';
 if(r?.ok===false&&r.committed!==false)return '本次保存未确认，原路径可能已经更新。各版本已保留，请检查恢复材料；不会自动重试或回退。';
 if(o?.stopped)return ['changed','missing'].includes(current.linkedFile?.checked?.state)
  ?'保存已暂停：磁盘文件已变化或移走，当前草稿保留。请打开磁盘版核对，或另存新文件。'
  :'保存仍暂停：再次检查不会恢复写回。当前草稿保留，请打开磁盘版核对或另存新文件。';
 return r?.ok===false?'未保存回原文件。请保留草稿，重新打开原文件核对，或另存新文件。':'';
}
