// Main supplies verified raster data only. Markdown URLs never become browser requests.
export function createImagePreviews({api,context}) {
 const nodes=new Set();
 function sync(){
  const c=context(),s=c.state;if(!s||c.loading||s.pending||s.historyPending||s.source!==s.confirmed.source)return;
  for(const item of nodes){
   const href=item.node.attrs.src,key=`${s.confirmed.sessionId}:${s.confirmed.revision}:${href}`;
   if(item.key===key)continue;item.key=key;
   if(item.loaded===`${s.confirmed.sessionId}:${href}`)continue;
   item.dom.classList.remove('has-preview');item.img.removeAttribute('src');item.img.hidden=true;item.note.textContent='图片引用 · 未加载预览';
   if(!/^markdown-image-[a-f0-9]{64}\.(png|jpg)$/.test(href))continue;
   const request={sessionId:s.confirmed.sessionId,expectedRevision:s.confirmed.revision,href};
   void api.imagePreview(request).then(r=>{
    if(!nodes.has(item)||item.key!==key||context().state?.confirmed.sessionId!==request.sessionId)return;
    if(!r?.ok){item.note.textContent='本地图片不可用 · 请保留附件或重新选择';return;}
    item.loaded=`${request.sessionId}:${href}`;item.dom.classList.add('has-preview');item.img.src=r.dataUrl;item.img.hidden=false;item.note.textContent='本地图片 · 随新文件导出';
   }).catch(()=>{if(item.key===key)item.note.textContent='本地图片预览未确认';});
  }
 }
 function nodeView({node}){
  const dom=document.createElement('figure');dom.className='document-image-reference';dom.dataset.documentImage='';dom.contentEditable='false';
  const img=document.createElement('img');img.hidden=true;img.alt=node.attrs.alt||'';img.className='document-local-image';
  const label=document.createElement('span');label.className='image-reference-label';label.textContent=node.attrs.alt||'图片（无说明）';
  const target=document.createElement('span');target.className='image-reference-target';target.textContent=node.attrs.src;
  const note=document.createElement('small');note.textContent='图片引用 · 未加载预览';dom.append(img,label,target,note);
  const item={node,dom,img,note,key:null,loaded:null};nodes.add(item);queueMicrotask(sync);
  return {dom,ignoreMutation:()=>true,destroy(){nodes.delete(item);img.removeAttribute('src');}};
 }
 return {nodeView,sync};
}
