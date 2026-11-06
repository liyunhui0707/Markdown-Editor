import {TextSelection} from '@tiptap/pm/state';
import {projectSource} from './document-source-map.mjs';
import {mapFormatEdit} from './document-format-edit.mjs';
import {TABLE_ROWS,TABLE_COLUMNS} from './document-table-source.mjs';

export function createTableView({byId,context,report}) {
  const ids=['insert-table','table-add-row','table-delete-row','table-add-column','table-delete-column','table-exit'];
  const blocked=c=>!c.state||!c.editor||c.loading||c.invalid||c.state.confirmed.readOnly||c.state.locked
    ||c.state.historyPending||c.state.composing||c.state.compositionInvalid||c.state.recoveryRecords.length||c.editor.view.composing;
  function locate(c) {
    if(!c.state||!c.editor)return null;
    const p=projectSource(c.state.source),{from,to}=c.editor.state.selection;
    const b=p.blocks.find(b=>b?.cells&&from>b.from&&to<b.to);
    const cell=b?.cells.flat().find(s=>from>=s.from&&to<=s.to);
    return cell?{block:b,cell}:null;
  }
  async function run(action) {
    const c=context();if(blocked(c)||c.state.pending)return false;
    const {from,to}=c.editor.state.selection;
    const ok=await c.controller.format({action,from,to});
    if(context().controller!==c.controller)return false;
    if(!ok)report('未应用表格操作，原文已保留。请把光标放入单个单元格；表头和最后一列不能删除。表格最多 8 列、32 行，仅支持普通文本。',true);
    else report('');
    c.editor.view.focus();sync();return ok;
  }
  function sync() {
    const c=context(),at=locate(c),busy=!!blocked(c)||!!c.state?.pending,empty=c.editor?.state.selection.empty;
    byId('table-tools').hidden=!at||!!c.state?.confirmed.readOnly;
    byId('insert-table').disabled=busy||!empty||c.editor?.state.selection.$from.depth!==1||c.editor?.state.selection.$from.parent.type.name!=='paragraph';
    for(const id of ids.slice(1))byId(id).disabled=busy||!empty||!at;
    if(at) {
      byId('table-add-row').disabled||=at.block.cells.length>=TABLE_ROWS;
      byId('table-delete-row').disabled||=at.cell.tableRow===0;
      byId('table-add-column').disabled||=at.block.cells[0].length>=TABLE_COLUMNS;
      byId('table-delete-column').disabled||=at.block.cells[0].length<=1;
      byId('table-position').textContent=`${at.cell.tableRow===0?'表头':'第 '+at.cell.tableRow+' 行'} · 第 ${at.cell.tableCol+1} 列`;
    }
  }
  for(const id of ids){byId(id).onpointerdown=e=>e.preventDefault();byId(id).onclick=()=>void run(id);}
  function key(view,event) {
    const c=context(),at=locate(c);if(!at||blocked(c)||event.isComposing||event.keyCode===229)return false;
    const {from,to,empty}=view.state.selection,{block,cell}=at;
    const plain=!event.metaKey&&!event.ctrlKey&&!event.altKey;
    let action=null,target=null;
    if((event.metaKey||event.ctrlKey)&&!event.altKey&&!event.shiftKey&&event.key==='Enter')action='table-exit';
    else if(plain&&event.key==='Tab'&&empty) {
      const cells=block.cells.flat(),i=cells.indexOf(cell)+(event.shiftKey?-1:1);
      target=cells[i];if(!target&&i===cells.length)action='table-add-row';
    } else if(plain&&event.key==='Enter'&&empty&&!event.shiftKey){
      target=block.cells[cell.tableRow+1]?.[cell.tableCol];if(!target)action='table-add-row';
    } else if(plain&&empty&&((event.key==='Backspace'&&from===cell.from)||(event.key==='Delete'&&from===cell.to))){event.preventDefault();return true;}
    else if(plain&&['Enter','Tab'].includes(event.key)){event.preventDefault();report('请先收起选区。单元格内不插入换行；用 Tab 切换单元格，⌘Enter 回到正文。',true);return true;}
    else return false;
    event.preventDefault();
    if(target){view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,target.from)).setStoredMarks(null).scrollIntoView());return true;}
    if(!action)return true;
    const command={action,from,to},mapped=mapFormatEdit(c.state.source,command);
    if(!mapped.ok){report('未应用操作，表格已保留。最多支持 32 行；可用 ⌘Enter 回到正文。',true);return true;}
    const doc=view.state.schema.nodeFromJSON(mapped.projection.doc),tr=view.state.tr;
    if(mapped.source!==c.state.source)tr.replaceWith(0,view.state.doc.content.size,doc.content).setMeta('document-block-shortcut',command);
    tr.setSelection(TextSelection.create(tr.doc,mapped.selection.from,mapped.selection.to)).setStoredMarks(null);
    view.dispatch(tr.scrollIntoView());return true;
  }
  return {sync,key,run};
}
