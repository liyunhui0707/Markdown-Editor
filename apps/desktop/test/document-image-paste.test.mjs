import test from 'node:test';
import assert from 'node:assert/strict';
import {createImagePaste} from '../lib/document-image-paste.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
const href='markdown-image-'+'a'.repeat(64)+'.png';
function fixture(){
 const edits=[],calls=[],notices=[],busy=[];let done;
 const state={confirmed:{sessionId:'s',revision:1,readOnly:false,source:''},source:'',recoveryRecords:[]},editor={view:{composing:false,focus(){}},state:{selection:{from:1,to:1}}};
 const controller={format:async c=>{edits.push(c);return true;}},context={state,editor,controller,selected:'s',loading:false,invalid:false};
 const api={importPastedImage:async r=>{calls.push(r);return {ok:true,sessionId:'s',revision:1,href};}};
 const view=createImagePaste({api,context:()=>context,busy:b=>{busy.push(b);context.loading=b;},report:m=>notices.push(m),settled:p=>{done=p;}});
 return {view,api,context,edits,calls,notices,busy,done:()=>done};
}
const event=file=>({prevented:false,preventDefault(){this.prevented=true;},clipboardData:{files:[file],types:['Files','text/html'],getData(){throw Error('HTML must not be read');}}});
test('image paste uses only event raster bytes and one verified format/history command',async()=>{
 const f=fixture(),e=event(new File([png],'screenshot.png',{type:'image/png'}));assert.equal(f.view.paste(e),true);assert(e.prevented);await f.done();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].base64,png.toString('base64'));assert.deepEqual(f.edits,[{action:'set-image',from:1,to:1,label:'粘贴的图片',href}]);assert.deepEqual(f.busy,[true,false]);
});
test('image paste refuses readonly, composition, selection, oversized or multiple images before import',async()=>{
 for(const change of [c=>c.state.confirmed.readOnly=true,c=>c.state.composing=true,c=>c.editor.state.selection.to=2]){
  const f=fixture();change(f.context);f.view.paste(event(new File([png],'p.png',{type:'image/png'})));if(f.done())await f.done();assert.equal(f.calls.length,0);
 }
 for(const file of [new File(['<svg/>'],'p.svg',{type:'image/svg+xml'}),new File([new Uint8Array(4194305)],'p.png',{type:'image/png'})]){
  const f=fixture();f.view.paste(event(file));if(f.done())await f.done();assert.equal(f.calls.length,0);assert.equal(f.edits.length,0);
 }
 const f=fixture(),e=event(new File([png],'p.png',{type:'image/png'}));e.clipboardData.files.push(e.clipboardData.files[0]);f.view.paste(e);assert.equal(f.calls.length,0);
});
test('late clipboard reads and invalid main receipts never mutate another document',async()=>{
 const f=fixture();let release;const e=event({type:'image/png',size:png.length,arrayBuffer:()=>new Promise(r=>release=r)});f.view.paste(e);f.context.controller={};release(png.buffer.slice(png.byteOffset,png.byteOffset+png.length));await f.done();assert.equal(f.calls.length,0);assert.equal(f.edits.length,0);
});

test('invalid or unknown import results leave text unchanged and retain an actionable final notice',async()=>{
 for(const reply of [{ok:false,code:'unsupported-image'},{ok:false,code:'image-import-unknown'},{ok:true,sessionId:'other',revision:1,href}]){
  const f=fixture();f.api.importPastedImage=async()=>reply;f.view.paste(event(new File([png],'p.png',{type:'image/png'})));await f.done();assert.equal(f.edits.length,0);assert.equal(f.context.loading,false);assert(f.notices.at(-1).includes(reply.code==='unsupported-image'?'无法解码':'不要重复'));
 }
});
