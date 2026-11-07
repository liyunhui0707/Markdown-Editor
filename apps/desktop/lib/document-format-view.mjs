// Small command surface over the same source controller and main-owned history.
export function createFormatView({ byId, context, report }) {
  const actions=['paragraph','heading-1','heading-2','heading-3','heading-4','heading-5','heading-6','bullet-list','ordered-list','task-list','blockquote','code-block'];
  const blocked=()=>{const {state:s,loading,invalid}=context();return !s || s.confirmed.readOnly || s.locked || invalid || loading || s.composing || s.compositionInvalid || s.pending || s.historyPending || s.recoveryRecords.length;};
  async function run(action) {
    const c=context(); if(blocked()||!c.editor) return false;
    const {from,to}=c.editor.state.selection;
    const ok=await c.controller.format({action,from,to});
    if(context().controller!==c.controller) return false;
    if(!ok) report(c.controller.state().code==='unsafe-format-range'
      ? '此处暂不支持该格式操作，原文已保留。标题限单行；粗体/斜体/行内代码需选中同一文字片段（取消时选中完整格式文字），暂不支持叠加；链接请使用链接面板；引用限单层，带格式引用暂不拆分；代码块用 ⌘Enter 回到正文。列表支持六层以内的紧凑列表；Tab 缩进、Shift+Tab 提升，顶层空项退出仅支持首项或末项。'
      : '格式修改未确认，当前内容仍保留。请查看输入或会话状态。',true);
    else report(action==='code-block'?'代码块中 Enter 换行、Tab 缩进；⌘Enter 回到正文。':action==='blockquote'?'引用中 Enter 分段，末尾空段再按 Enter 回到正文。':'格式已应用；原文件未改写。');
    if(!context().invalid && !c.controller.state().locked) c.editor.view.focus();
    sync(); return ok;
  }
  const selector=byId('format-block');
  selector.onchange=()=>{if(actions.includes(selector.value))void run(selector.value);};
  for(const mark of ['bold','italic','code']) {
    byId('format-'+mark).onpointerdown=e=>e.preventDefault();
    byId('format-'+mark).onclick=()=>void run(mark);
  }
  for(const id of ['format-undo','format-redo']) {
    byId(id).onpointerdown=e=>e.preventDefault();
    byId(id).onclick=async()=>{const c=context();if(blocked())return;await c.controller.history(id==='format-undo'?'undo':'redo');if(context().controller===c.controller)c.editor.view.focus();};
  }
  function sync() {
    const {state:s,editor}=context();
    byId('format-toolbar').hidden=!s || s.confirmed.readOnly || s.confirmed.temporary!==true;
    const busy=!!blocked();selector.disabled=busy;for(const mark of ['bold','italic','code'])byId('format-'+mark).disabled=busy||!editor||editor.state.selection.empty||editor.state.selection.node?.type.name==='documentImage'||(editor.state.selection.$from.parent.type.name==='codeBlock'||editor.isActive('table'));
    byId('format-undo').disabled=busy||!s?.confirmed.canUndo;byId('format-redo').disabled=busy||!s?.confirmed.canRedo;
    let value=editor?.state.selection.node?.type.name==='documentImage'?'image':'paragraph';
    if(editor) {
      const pos=editor.state.selection.$from;
      for(let depth=1;depth<=pos.depth;depth++) {
        const node=pos.node(depth);
        if(node.type.name==='bulletList') {value='bullet-list';}
        if(node.type.name==='orderedList') {value='ordered-list';}
        if(node.type.name==='listItem'&&typeof node.attrs.checked==='boolean')value='task-list';
        if(node.type.name==='heading')value='heading-'+node.attrs.level;
        if(node.type.name==='table')value='table';
        if(node.type.name==='blockquote')value='blockquote';
        if(node.type.name==='codeBlock')value=node.attrs.sourceEditable?'code-block':'unsupported';
      }
    }
    selector.value=value;
    for(const mark of ['bold','italic','code'])byId('format-'+mark).setAttribute('aria-pressed',String(!!editor?.isActive(mark)));
  }
  function key(view,event) {
    if(event.isComposing||event.keyCode===229||view.composing||context().state?.composing)return false;
    if((event.metaKey||event.ctrlKey)&&!event.altKey&&['b','i','e'].includes(event.key.toLowerCase())) {event.preventDefault();void run(({b:'bold',i:'italic',e:'code'})[event.key.toLowerCase()]);return true;}
    const pos=view.state.selection.$from,inList=Array.from({length:pos.depth},(_,i)=>pos.node(i+1).type.name).some(n=>n==='bulletList'||n==='orderedList');
    if(pos.parent.type.name==='heading'&&event.key==='Enter'&&!event.shiftKey&&!event.metaKey&&!event.ctrlKey&&!event.altKey) {event.preventDefault();void run(pos.parent.content.size?'split-heading':'paragraph');return true;}
    if(pos.parent.type.name==='heading'&&event.key==='Backspace'&&pos.parentOffset===0&&view.state.selection.empty&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey) {event.preventDefault();void run('paragraph');return true;}
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
