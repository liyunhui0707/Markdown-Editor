import test from 'node:test';
import assert from 'node:assert/strict';
import {createImagePreviews} from '../lib/document-image-preview.mjs';

const href='markdown-image-'+'a'.repeat(64)+'.png',dataUrl='data:image/png;base64,AAAA';
function fixture(){
 const old=globalThis.document,calls=[],pending=[];
 globalThis.document={createElement(tag){return {tag,children:[],dataset:{},hidden:false,
  classList:{add(){},remove(){}},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
  removeAttribute(name){delete this[name];}};}};
 const state={confirmed:{sessionId:'first',revision:1,source:'confirmed'},source:'confirmed'};
 const context={state,loading:false};
 const previews=createImagePreviews({context:()=>context,api:{imagePreview(request){
  calls.push(request);return new Promise((resolve,reject)=>pending.push({resolve,reject}));
 }}});
 const views=[],images=new WeakMap();
 return {state,context,calls,pending,previews,views,
  add(src=href){const view=previews.nodeView({node:{attrs:{src,alt:'test'}}});views.push(view);images.set(view,view.dom.children[0]);return view;},
  image(view){return images.get(view);},note(view){return view.dom.children[3].textContent;},
  finish(){for(const view of views)view.destroy();globalThis.document=old;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('repeated image references share one verified preview response without a lasting data cache',async()=>{
 const f=fixture();try{
  const views=Array.from({length:40},()=>f.add());await tick();assert.equal(f.calls.length,1);
  f.pending[0].resolve({ok:true,dataUrl});await tick();
  for(const view of views)assert.equal(f.image(view).src,dataUrl);
  for(const view of views)view.destroy();
  const fresh=f.add();await tick();assert.equal(f.calls.length,2);assert.equal(f.image(fresh).src,undefined);
  f.pending[1].resolve({ok:true,dataUrl});await tick();assert.equal(f.image(fresh).src,dataUrl);
 }finally{f.finish();}
});
test('different verified names keep separate requests; unsupported URLs never request previews',async()=>{
 const f=fixture();try{
  f.add();f.add('markdown-image-'+'b'.repeat(64)+'.png');f.add('https://example.invalid/image.png');f.add('../image.png');
  await tick();assert.equal(f.calls.length,2);
  for(const p of f.pending)p.resolve({ok:false});await tick();
 }finally{f.finish();}
});
test('closed nodes cannot be revived by a late shared response',async()=>{
 const f=fixture();try{
  const a=f.add(),b=f.add();await tick();a.destroy();b.destroy();assert.equal(a.dom.children.length,0);assert.equal(b.dom.children.length,0);
  f.pending[0].resolve({ok:true,dataUrl});await tick();
  assert.equal(f.image(a).src,undefined);assert.equal(f.image(b).src,undefined);
 }finally{f.finish();}
});
test('a surviving node still receives a shared response when another occurrence closes',async()=>{
 const f=fixture();try{
  const a=f.add(),b=f.add();await tick();a.destroy();f.pending[0].resolve({ok:true,dataUrl});await tick();
  assert.equal(f.image(a).src,undefined);assert.equal(f.image(b).src,dataUrl);
 }finally{f.finish();}
});
test('revision changes use fresh authority and ignore earlier response ordering',async()=>{
 const f=fixture();try{
  const a=f.add(),b=f.add();await tick();f.state.confirmed.revision++;f.previews.sync();await tick();
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(c=>c.expectedRevision),[1,2]);
  f.pending[1].resolve({ok:true,dataUrl});await tick();f.pending[0].resolve({ok:true,dataUrl:'stale'});await tick();
  assert.equal(f.image(a).src,dataUrl);assert.equal(f.image(b).src,dataUrl);
 }finally{f.finish();}
});
test('session switch cannot reuse or receive an old session preview',async()=>{
 const f=fixture();try{
  const a=f.add();await tick();f.state.confirmed.sessionId='second';f.previews.sync();await tick();
  assert.equal(f.calls.length,2);f.pending[0].resolve({ok:true,dataUrl:'stale'});await tick();
  assert.equal(f.image(a).src,undefined);f.pending[1].resolve({ok:true,dataUrl});await tick();assert.equal(f.image(a).src,dataUrl);
 }finally{f.finish();}
});
test('failed or rejected shared requests do not loop; a new confirmed revision can retry',async()=>{
 for(const reject of [false,true]){
  const f=fixture();try{
   const a=f.add();f.add();await tick();assert.equal(f.calls.length,1);
   if(reject)f.pending[0].reject(Error('unavailable'));else f.pending[0].resolve({ok:false});await tick();
   f.previews.sync();await tick();assert.equal(f.calls.length,1);assert.equal(f.image(a).src,undefined);
   f.state.confirmed.revision++;f.previews.sync();await tick();assert.equal(f.calls.length,2);
   f.pending[1].resolve({ok:true,dataUrl});await tick();assert.equal(f.image(a).src,dataUrl);
  }finally{f.finish();}
 }
});
test('typing and loading fences prevent preview requests until a confirmed surface is ready',async()=>{
 const f=fixture();try{
  f.state.pending=true;f.add();await tick();assert.equal(f.calls.length,0);f.state.pending=false;
  f.state.source='unconfirmed';f.previews.sync();await tick();assert.equal(f.calls.length,0);
  f.state.source=f.state.confirmed.source;f.context.loading=true;f.previews.sync();await tick();assert.equal(f.calls.length,0);
  f.context.loading=false;f.previews.sync();await tick();assert.equal(f.calls.length,1);
  f.pending[0].resolve({ok:true,dataUrl});await tick();
 }finally{f.finish();}
});
test('already verified visible images survive ordinary revisions without another transfer',async()=>{
 const f=fixture();try{
  const a=f.add();await tick();f.pending[0].resolve({ok:true,dataUrl});await tick();
  f.state.confirmed.revision++;f.previews.sync();await tick();
  assert.equal(f.calls.length,1);assert.equal(f.image(a).src,dataUrl);
 }finally{f.finish();}
});
