import {EditorState,StateField,StateEffect,Facet} from '@codemirror/state';
import {history,invertedEffects} from '@codemirror/commands';
import edits from './document-source-edit.js';
export const displaySource=source=>source.replace(/\r\n|\r/g,'\n');
export const displayOffset=(source,offset)=>displaySource(source.slice(0,offset)).length;
export function rawOffset(source,offset) {
 let raw=0,visible=0;
 while(raw<source.length&&visible<offset){raw+=source[raw]==='\r'&&source[raw+1]==='\n'?2:1;visible++;}
 return raw;
}
const initialSource=Facet.define({combine:values=>values[0]||''});
const restoreSource=StateEffect.define();
function nextSource(tr) {
 const restored=tr.effects.filter(effect=>effect.is(restoreSource));
 if(restored.length) {
  // History combines inverse effects newest-first. Apply every inverse in order;
  // one whole-source snapshot per key would both break grouping and retain too much.
  let source=tr.startState.field(rawSource);
  for(const effect of restored){const patch=edits.sourceChange(source,effect.value);if(!patch.ok)throw Error('Invalid source history');source=patch.source;}
  if(displaySource(source)!==tr.newDoc.toString())throw Error('Source history diverged');
  return source;
 }
 const source=tr.startState.field(rawSource);let next='',previous=0;
 tr.changes.iterChanges((from,to,_newFrom,_newTo,inserted)=>{
  const start=rawOffset(source,from),end=rawOffset(source,to);
  const ending=source.slice(start).match(/\r\n|\r|\n/)?.[0]||source.match(/\r\n|\r|\n/)?.[0]||'\n';
  next+=source.slice(previous,start)+inserted.toString().replaceAll('\n',ending);previous=end;
 });
 return next+source.slice(previous);
}
export const rawSource=StateField.define({
 create:state=>state.facet(initialSource),
 update:(value,tr)=>tr.docChanged?nextSource(tr):value,
});
// CodeMirror's display uses LF. This field preserves untouched raw separators;
// its inverse effect restores exact mixed endings for local Undo/Redo.
export function sourceState(source,extensions=[],onRejected=()=>{}) {
 if(!edits.sourceDifference(source,source).ok)throw Error('Invalid source buffer');
 return EditorState.create({doc:displaySource(source),extensions:[initialSource.of(source),rawSource,
  EditorState.transactionFilter.of(tr=>{
   if(!tr.docChanged)return tr;
   const next=nextSource(tr);
   if(!edits.sourceDifference(tr.startState.field(rawSource),next).ok||displaySource(next)!==tr.newDoc.toString()){
    onRejected();return [];
   }
   return tr;
  }),
  history(),invertedEffects.of(tr=>tr.docChanged?[restoreSource.of(edits.sourceDifference(tr.startState.field(rawSource),nextSource(tr)).inverse)]:[]),...extensions]});
}
