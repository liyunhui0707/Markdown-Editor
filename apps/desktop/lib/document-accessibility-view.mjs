// Presentation/focus only. Existing controllers retain all edit and save authority.
export function createAccessibilityView({byId,context}) {
  const doc=byId('writing-app').ownerDocument;
  let enabled=false;
  const blocked=()=>{const {state:s,editor,loading}=context();return loading||editor?.view.composing
    ||s?.pending||s?.historyPending||s?.composing||s?.compositionInvalid;};
  const available=node=>node&&!node.disabled&&!node.closest('[hidden],[inert]');
  const visible=node=>available(node)&&node.getClientRects().length>0;
  const attribute=(node,name,value)=>{if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
  const bars=['format-inline-tools','reading-tools','table-tools'].map(id=>{
    const node=byId(id);let remembered=null;
    const buttons=()=>[...node.querySelectorAll('button')];
    function sync(){
      const items=buttons(),ready=items.filter(available);
      const selected=ready.includes(remembered)?remembered:ready[0];
      for(const item of items)attribute(item,'tabindex',item===selected?'0':'-1');
      return ready;
    }
    node.addEventListener('focusin',event=>{if(enabled&&buttons().includes(event.target)){remembered=event.target;sync();}});
    node.addEventListener('keydown',event=>{
      if(!enabled||blocked()||event.defaultPrevented||event.isComposing||event.keyCode===229
          ||event.metaKey||event.ctrlKey||event.altKey||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const items=sync(),at=items.indexOf(doc.activeElement);if(at<0)return;
      const next=event.key==='Home'?0:event.key==='End'?items.length-1
        :(at+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
      event.preventDefault();items[next].focus();
    });
    return {sync,focus(){const items=sync();(items.find(n=>n.tabIndex===0)||items[0])?.focus();}};
  });
  doc.addEventListener('keydown',event=>{
    if(!enabled||blocked()||event.defaultPrevented||event.isComposing||event.keyCode===229
        ||doc.querySelector('dialog[open]'))return;
    if(event.key==='F10'&&event.altKey&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey){
      if(visible(byId('format-inline-tools'))){event.preventDefault();bars[0].focus();}return;
    }
    if(event.key==='F6'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
      const editor=context().editor;
      const groups=[['document-sidebar',byId('session-filter')],['document-header',byId('toggle-session-sidebar')],
        ['writing-toolbar',visible(byId('format-block'))?byId('format-block'):byId('show-reading-settings')],
        ['document-scroll',editor?.view.dom||byId('empty-new')],['document-outline',byId('outline-filter')]]
        .filter(([,target])=>visible(target));
      if(!groups.length)return;
      const at=groups.findIndex(([id])=>byId(id).contains(doc.activeElement));
      const next=at<0?(event.shiftKey?groups.length-1:0):(at+(event.shiftKey?-1:1)+groups.length)%groups.length;
      event.preventDefault();groups[next][1].focus({preventScroll:true});
    }else if(event.key==='Escape'&&globalThis.matchMedia?.('(max-width: 760px)').matches
        &&byId('writing-app').dataset.sidebar==='open'){
      event.preventDefault();byId('close-session-sidebar').click();
    }
  });
  function sync(){
    if(!enabled)return;
    bars.forEach(bar=>bar.sync());
    const {editor,state}=context();if(!editor||!state?.confirmed)return;
    const node=editor.view.dom,readOnly=state.confirmed.readOnly===true;
    attribute(node,'role',readOnly?'document':'textbox');
    attribute(node,'aria-label',(readOnly?'只读正文：':'正文编辑：')+state.confirmed.label);
    if(readOnly){node.removeAttribute('aria-multiline');node.removeAttribute('aria-readonly');}
    else{attribute(node,'aria-multiline','true');attribute(node,'aria-readonly',String(!editor.isEditable));}
  }
  return {sync,configure(){
    // Explicit Tab stops keep modal buttons reachable across macOS keyboard settings.
    for(const button of doc.querySelectorAll('dialog button'))attribute(button,'tabindex','0');
    enabled=true;sync();
  }};
}
