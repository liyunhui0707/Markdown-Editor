// Small command surface over the same source controller and main-owned history.
export function createFormatView({ byId, context, report }) {
  const actions=['paragraph','heading-1','heading-2','heading-3','bullet-list','ordered-list'];
  const blocked=()=>{const {state:s,loading,invalid}=context();return !s || s.confirmed.readOnly || s.locked || invalid || loading || s.composing || s.compositionInvalid || s.pending || s.historyPending || s.recoveryRecords.length;};
  async function run(action) {
    const c=context(); if(blocked()||!c.editor) return false;
    const {from,to}=c.editor.state.selection;
    const ok=await c.controller.format({action,from,to});
    if(context().controller!==c.controller) return false;
    if(!ok) report(c.controller.state().code==='unsafe-format-range'
      ? '此处暂不支持该格式操作，原文已保留。标题限单行；加粗需选中同一段文字（取消时选中完整粗体）；列表限单层，空项退出仅支持首项或末项。'
      : '格式修改未确认，当前内容仍保留。请查看输入或会话状态。',true);
    else report('格式已应用；原文件未改写。');
    if(!context().invalid && !c.controller.state().locked) c.editor.view.focus();
    sync(); return ok;
  }
  const selector=byId('format-block');
  selector.onchange=()=>{if(actions.includes(selector.value))void run(selector.value);};
  byId('format-bold').onpointerdown=e=>e.preventDefault();
  byId('format-bold').onclick=()=>void run('bold');
  for(const id of ['format-undo','format-redo']) {
    byId(id).onpointerdown=e=>e.preventDefault();
    byId(id).onclick=async()=>{const c=context();if(blocked())return;await c.controller.history(id==='format-undo'?'undo':'redo');if(context().controller===c.controller)c.editor.view.focus();};
  }
  function sync() {
    const {state:s,editor}=context();
    byId('format-toolbar').hidden=!s || s.confirmed.readOnly || s.confirmed.temporary!==true;
    const busy=!!blocked();selector.disabled=busy;byId('format-bold').disabled=busy||!editor||editor.state.selection.empty;
    byId('format-undo').disabled=busy||!s?.confirmed.canUndo;byId('format-redo').disabled=busy||!s?.confirmed.canRedo;
    let value='paragraph';
    if(editor) {
      const pos=editor.state.selection.$from;
      for(let depth=1;depth<=pos.depth;depth++) {
        const node=pos.node(depth);
        if(node.type.name==='bulletList') {value='bullet-list';break;}
        if(node.type.name==='orderedList') {value='ordered-list';break;}
        if(node.type.name==='heading')value='heading-'+node.attrs.level;
        if(node.type.name==='codeBlock')value='unsupported';
      }
    }
    selector.value=value;
    byId('format-bold').setAttribute('aria-pressed',String(!!editor?.isActive('bold')));
  }
  function key(view,event) {
    if(event.isComposing||event.keyCode===229||view.composing||context().state?.composing)return false;
    if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='b') {event.preventDefault();void run('bold');return true;}
    const pos=view.state.selection.$from,inList=Array.from({length:pos.depth},(_,i)=>pos.node(i+1).type.name).some(n=>n==='bulletList'||n==='orderedList');
    if(pos.parent.type.name==='heading'&&event.key==='Enter'&&!event.shiftKey&&!event.metaKey&&!event.ctrlKey&&!event.altKey) {event.preventDefault();void run('split-heading');return true;}
    if(inList && !event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey &&
      (event.key==='Enter'||(event.key==='Backspace'&&pos.parentOffset===0&&view.state.selection.empty))) {
      event.preventDefault();void run(event.key==='Enter'?'split-list':'join-list');return true;
    }
    if(pos.depth===1 && pos.parent.type.name==='paragraph' && view.state.selection.empty
        && !event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey) {
      const marked=n=>n?.type.name==='paragraph'&&n.content.content.some(child=>child.marks.length);
      const previous=view.state.doc.childBefore(pos.before()).node;
      if(event.key==='Enter' && marked(pos.parent)) {event.preventDefault();void run('split-paragraph');return true;}
      if(event.key==='Backspace' && pos.parentOffset===0 && previous && (marked(pos.parent)||marked(previous))) {
        event.preventDefault();void run('join-paragraph');return true;
      }
    }
    return false;
  }
  return {sync,key,run};
}
