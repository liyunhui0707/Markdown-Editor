import test from 'node:test';import assert from 'node:assert/strict';
import {createOriginalSaveView} from '../lib/document-original-save-view.mjs';
function fixture(){
 const nodes=new Map(),doc={createElement:()=>({})};let loading=false;
 const byId=id=>{if(!nodes.has(id))nodes.set(id,{ownerDocument:doc,childNodes:[],dataset:{},replaceChildren(){this.childNodes=[];},append(n){this.childNodes.push(n);},addEventListener(){}});return nodes.get(id);};
 const s={confirmed:{originalSave:{available:true,stopped:true},linkedFile:{filePath:'/synthetic/a.md',checked:{state:'unchanged'}},source:'local'},source:'local',recoveryRecords:[]};
 const view=createOriginalSaveView({api:{},byId,context:()=>({selected:'A',loading,controller:{state:()=>s}}),busy:v=>loading=v,rerender(){},focus(){}});
 return {s,byId,view};
}
test('stopped-save inline recovery actions preserve all input fences and explain a recheck',()=>{
 const h=fixture();h.view.render(h.s);assert.match(h.byId('original-save-status').childNodes[0].textContent,/保存仍暂停/);
 for(const key of ['pending','historyPending','composing','compositionInvalid','locked']){
  h.s[key]=true;h.view.render(h.s);for(const b of h.byId('original-save-status').childNodes.filter(n=>n.type==='button'))assert(b.disabled,key);h.s[key]=false;
 }
});
