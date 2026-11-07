import {EditorState,Compartment} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine,drawSelection} from '@codemirror/view';
import {defaultKeymap,historyKeymap,undo,redo,undoDepth,redoDepth} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {syntaxHighlighting,HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';
const sourceHighlight=HighlightStyle.define([
 {tag:[tags.keyword,tags.bool,tags.number,tags.url,tags.link],color:'var(--accent)'},
 {tag:[tags.tagName,tags.attributeName,tags.string],color:'var(--ink)'},
 {tag:[tags.comment,tags.meta,tags.processingInstruction],color:'var(--muted)'},
 {tag:tags.heading,fontWeight:'600'},{tag:tags.strong,fontWeight:'700'},
 {tag:tags.emphasis,fontStyle:'italic'},{tag:tags.strikethrough,textDecoration:'line-through'},
]);
import {searchKeymap} from '@codemirror/search';
import {sourceState,rawSource,displayOffset,rawOffset} from './document-source-buffer.mjs';
export function createSourceEditor({parent,source,selection=0,changed=()=>{},rejected=()=>{},apply=()=>{}}) {
 const wrap=new Compartment(),lock=new Compartment();let composing=false;
 const view=new EditorView({parent,state:sourceState(source,[
  lineNumbers(),highlightActiveLine(),drawSelection(),markdown(),syntaxHighlighting(sourceHighlight),
  wrap.of(EditorView.lineWrapping),lock.of([]),
  EditorView.contentAttributes.of({'aria-label':'Markdown 源码编辑','spellcheck':'false'}),
  keymap.of([{key:'Mod-s',run:()=>{apply();return true;}},{key:'Mod-Enter',run:()=>{apply();return true;}},...defaultKeymap,...historyKeymap,...searchKeymap]),
  EditorView.domEventHandlers({compositionstart(){composing=true;changed();},compositionend(){composing=false;queueMicrotask(changed);}}),
  EditorView.updateListener.of(update=>changed(update.docChanged)),
 ],rejected)});
 view.dispatch({selection:{anchor:displayOffset(source,Math.min(source.length,Math.max(0,selection)))}});
 return {
  get source(){return view.state.field(rawSource);},
  get composing(){return composing||view.composing;},
  get selection(){return rawOffset(view.state.field(rawSource),view.state.selection.main.head);},
  get canUndo(){return undoDepth(view.state)>0;},get canRedo(){return redoDepth(view.state)>0;},
  undo:()=>undo(view),redo:()=>redo(view),
  focus(){view.focus();},selectAll(){view.dispatch({selection:{anchor:0,head:view.state.doc.length}});view.focus();},
  setWrap(value){view.dispatch({effects:wrap.reconfigure(value?EditorView.lineWrapping:[])});},
  setLocked(value){view.dispatch({effects:lock.reconfigure([EditorState.readOnly.of(value),EditorView.editable.of(!value)])});},
  destroy(){view.destroy();},
 };
}
