import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {EditorState} from '@tiptap/pm/state';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource} from '../lib/document-source-map.mjs';
import {dropImage} from '../lib/document-image-drop.mjs';
function fixture(source='Before\n\nAfter',position=10){
 const schema=getSchema(documentEditorExtensions()),calls=[],reports=[],state={source,confirmed:{source,readOnly:false}};
 const view={state:EditorState.create({schema,doc:schema.nodeFromJSON(projectSource(source).doc)}),posAtCoords:()=>({pos:position}),dispatch(tr){this.state=this.state.apply(tr);}};
 const files=[new File(['raster'],'picture.png',{type:'image/png'})];let prevented=false;
 const event={clientX:123,clientY:234,preventDefault(){prevented=true;},dataTransfer:{files,getData(){throw Error('must not read URL or HTML');}}};
 const options={state,blocked:false,report:(...v)=>reports.push(v),paste:{paste:(e,label)=>{calls.push({files:e.clipboardData.files,label,position:view.state.selection.from});return true;}}};
 return {view,event,options,calls,reports,prevented:()=>prevented};
}
test('raster drop targets the actual safe paragraph and reuses bounded paste without reading HTML or paths',()=>{
 const f=fixture();assert.equal(dropImage(f.view,f.event,f.options),true);assert(f.prevented());assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].position,10);assert.equal(f.calls[0].label,'拖入的图片');assert.equal(f.calls[0].files[0],f.event.dataTransfer.files[0]);
});
test('drop never falls through for unsafe structures, links, multiple files or unconfirmed input',()=>{
 for(const modify of [f=>f.options.blocked=true,f=>f.options.state.composing=true,f=>f.options.state.pending=1,f=>f.options.state.confirmed.readOnly=true,f=>f.view.posAtCoords=()=>null,f=>f.event.dataTransfer.files=[],f=>f.event.dataTransfer.files.push(f.event.dataTransfer.files[0]),f=>f.event.dataTransfer.files=[new File(['<svg/>'],'a.svg',{type:'image/svg+xml'})],f=>f.event.dataTransfer.files=[new File([new Uint8Array(4194305)],'a.png',{type:'image/png'})]]){
  const f=fixture();modify(f);assert.equal(dropImage(f.view,f.event,f.options),true);assert(f.prevented());assert.deepEqual(f.calls,[]);assert.equal(f.view.state.selection.from,1);
 }
 const f=fixture('> quote',2);dropImage(f.view,f.event,f.options);assert.deepEqual(f.calls,[]);
});
