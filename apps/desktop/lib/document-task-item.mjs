import {ListItem} from '@tiptap/extension-list-item';
// A checkbox is only an input affordance. It never changes PM attributes or
// writes source itself; the same guarded format command owns the transaction.
export function taskListItem(onToggle=()=>{}) {
 return ListItem.extend({
  addAttributes(){return {...this.parent?.(),checked:{default:null,rendered:false}};},
  addNodeView(){return ({node,view,getPos})=>{
   const dom=document.createElement('li'),contentDOM=document.createElement('div'),button=document.createElement('button');
   button.type='button';button.contentEditable='false';button.className='document-task-toggle';button.setAttribute('role','checkbox');
   const update=current=>{
    if(current.type.name!=='listItem')return false;
    const task=typeof current.attrs.checked==='boolean';
    dom.toggleAttribute('data-task-item',task);button.hidden=!task;
    button.setAttribute('aria-checked',String(current.attrs.checked===true));
    button.setAttribute('aria-label',current.attrs.checked?'标记为未完成':'标记为已完成');
    button.textContent=current.attrs.checked?'✓':'';button.setAttribute('aria-disabled',String(!view.editable));
    return true;
   };
   button.onmousedown=e=>e.preventDefault();
   button.onclick=e=>{e.preventDefault();const at=getPos();if(typeof at==='number')onToggle(view,at+2);};
   dom.append(button,contentDOM);update(node);
   return {dom,contentDOM,update,stopEvent:event=>button.contains(event.target),
    ignoreMutation:m=>m.type!=='selection'&&!contentDOM.contains(m.target)};
  };},
 });
}
