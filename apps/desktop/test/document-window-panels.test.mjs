import test from 'node:test';import assert from 'node:assert/strict';
import {dismissPassivePanels} from '../lib/document-window-panels.mjs';
function fixture(){const nodes=new Map(),byId=id=>{if(!nodes.has(id))nodes.set(id,{open:false,disabled:false});return nodes.get(id);};return {byId,nodes};}
test('passive panels dismiss through their existing guarded close controls',()=>{
 const h=fixture();for(const [id,button]of [['document-details-dialog','close-document-details-dialog'],['recent-dialog','close-recent-dialog'],['reading-settings-dialog','close-reading-settings'],['draft-dialog','close-draft-dialog'],['file-comparison-dialog','close-file-comparison']]){
  h.byId(id).open=true;h.byId(button).click=()=>{h.byId(id).open=false;};
 }
 assert.equal(dismissPassivePanels(h.byId),true);assert.equal([...h.nodes.values()].some(n=>n.open),false);
});
test('unapplied source, links, names and image forms are never dismissed',()=>{
 const h=fixture();for(const id of ['source-dialog','link-dialog','name-dialog','image-dialog'])h.byId(id).open=true;
 assert.equal(dismissPassivePanels(h.byId),false);assert.equal([...h.nodes.values()].filter(n=>n.open).length,4);
});
test('a disabled or refusing panel close is not bypassed by native window closing',()=>{
 const h=fixture();h.byId('draft-dialog').open=true;h.byId('close-draft-dialog').disabled=true;h.byId('close-draft-dialog').click=()=>assert.fail('Busy control');
 assert.equal(dismissPassivePanels(h.byId),false);assert.equal(h.byId('draft-dialog').open,true);
 h.byId('close-draft-dialog').disabled=false;h.byId('close-draft-dialog').click=()=>{};assert.equal(dismissPassivePanels(h.byId),false);assert.equal(h.byId('draft-dialog').open,true);
});
