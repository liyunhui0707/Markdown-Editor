import {imageSelection} from './document-image-edit.mjs';
import capacity from './document-capacity.js';
// Raster bytes come only from this explicit paste event. Never read global
// clipboard data, HTML, paths or remote URLs. Main decodes and budgets the asset.
export function createImagePaste({api,context,busy,report,settled=()=>{}}){
 let running=false;
 const blocked=c=>!c.controller||!c.editor||c.loading||c.invalid||c.state.confirmed.readOnly||c.state.locked||c.state.pending||c.state.historyPending||c.state.composing||c.state.compositionInvalid||c.state.recoveryRecords.length||c.editor.view.composing||c.state.source!==c.state.confirmed.source;
 function paste(event){
  const files=Array.from(event.clipboardData?.files||[]);
  if(!files.some(f=>f.type.startsWith('image/')))return false;
  event.preventDefault();const c=context(),fail=m=>{report(m,true);return true;};
  if(running||blocked(c))return fail('未粘贴图片：请先完成当前输入或操作，当前文字保留。');
  if(files.length!==1||!['image/png','image/jpeg'].includes(files[0].type)||!files[0].size||files[0].size>capacity.MAX_IMAGE_BYTES)return fail('未粘贴图片：每次支持一张不超过 4 MiB 的 PNG/JPEG。当前文字保留。');
  const selection={from:c.editor.state.selection.from,to:c.editor.state.selection.to};
  if(!imageSelection(c.state.source,selection))return fail('请把光标放在普通段落中粘贴图片，或先选中图片卡片。当前文字保留。');
  const owner={controller:c.controller,editor:c.editor,source:c.state.source,id:c.state.confirmed.sessionId,revision:c.state.confirmed.revision};
  const same=()=>{const next=context();return next.controller===owner.controller&&next.editor===owner.editor&&!next.invalid&&next.state.source===owner.source&&next.state.confirmed.revision===owner.revision&&next.state.confirmed.sessionId===owner.id&&next.editor.state.selection.from===selection.from&&next.editor.state.selection.to===selection.to;};
  running=true;busy(true);
  let outcome=null;const notify=(m,notice=true)=>{outcome={m,notice};return true;};
  const work=(async()=>{
   try{
    const bytes=new Uint8Array(await files[0].arrayBuffer());if(!same()||bytes.length!==files[0].size||bytes.length>capacity.MAX_IMAGE_BYTES)return notify('文档或图片已变化，未插入图片。');
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    const r=await api.importPastedImage({sessionId:owner.id,expectedRevision:owner.revision,base64:btoa(binary)});
    if(!same())return notify('文档状态已变化，未插入图片；原文保留。');
    if(!r?.ok){const messages={'document-busy':'文档仍在处理操作，请完成后再次粘贴。','stale-revision':'文档修订已变化，请确认光标后再次粘贴。','composition-active':'请先完成或取消输入法组合，再粘贴。','unsupported-image':'图片无法解码或尺寸超限，请使用有效的 PNG/JPEG。','image-size-limit':'图片超过 4 MiB，未导入。','image-session-capacity':'当前会话图片已达上限，请保留现有草稿。','image-count-limit':'每篇最多 16 张本地图片。','image-total-size-limit':'本篇图片合计超过 16 MiB。','image-total-pixel-limit':'本篇图片合计超过 3200 万像素。'};return notify((messages[r?.code]||'导入结果未获确认，请检查会话状态，不要重复粘贴。')+' 当前正文保留。');}
    if(r.sessionId!==owner.id||r.revision!==owner.revision||!/^markdown-image-[a-f0-9]{64}\.(png|jpg)$/.test(r.href))return notify('导入结果未获确认，当前正文保留；请检查会话状态，不要重复粘贴。');
    busy(false);
    const ok=await owner.controller.format({action:'set-image',...selection,label:'粘贴的图片',href:r.href});
    if(context().controller===owner.controller){if(ok){owner.editor.view.focus();notify('图片已粘贴，可撤销。请等待草稿备份；保存和另存时会携带附件。',false);}else notify('图片尚未插入，原文保留；请检查光标位置和会话状态。');}
   }catch{notify('图片粘贴未确认，原文保留；请检查会话状态，不要重复操作。');}
   finally{running=false;if(context().loading)busy(false);if(outcome&&context().controller===owner.controller)report(outcome.m,outcome.notice);}
  })();settled(work);return true;
 }
 return {paste};
}
