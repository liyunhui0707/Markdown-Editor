import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSource} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const set=(s,from,to,label,href)=>mapFormatEdit(s,{action:'set-link',from,to,label,href});
const inverse=(r)=>r.source.slice(0,r.inverseSource.from)+r.inverseSource.insert+r.source.slice(r.inverseSource.to);
for(const nl of ['\n','\r\n','\r'])for(const prefix of ['', '# ', '- ', '3) '])test(`link creation/update/remove preserves surroundings ${JSON.stringify([nl,prefix])}`,()=>{
 const before=prefix+'First word tail.'+nl+nl+'```md'+nl+'opaque'+nl+'```'+nl;
 const p=projectSource(before).spans[0];
 const created=set(before,p.from+6,p.from+10,'中文😀','https://example.test/a?q=1&b=2');assert.equal(created.ok,true);
 assert.equal(created.source,before.replace('word','[中文😀](<https://example.test/a?q=1&b=2>)'));assert.equal(inverse(created),before);
 const link=created.projection.spans.find(s=>s.link);
 const changed=set(created.source,link.from+1,link.from+1,'New','../other.md#section');assert.equal(changed.ok,true);
 assert.equal(changed.source,before.replace('word','[New](<../other.md#section>)'));assert.equal(inverse(changed),created.source);
 const next=changed.projection.spans.find(s=>s.link),removed=mapFormatEdit(changed.source,{action:'remove-link',from:next.from,to:next.to});
 assert.equal(removed.ok,true);assert.equal(removed.source,before.replace('word','New'));assert.equal(inverse(removed),changed.source);
});
test('insert into an empty paragraph and at a plain caret',()=>{
 assert.equal(set('',1,1,'Example','https://example.test').source,'[Example](<https://example.test>)');
 assert.equal(set('AB',2,2,'Link','#section').source,'A[Link](<#section>)B');
});
test('editing label preserves exact address spelling and title; changing address preserves title bytes',()=>{
 const source="A [label](a(b) 'Keep title') Z",p=projectSource(source).spans.find(s=>s.link);
 const label=set(source,p.from,p.to,'新的','a(b)');assert.equal(label.ok,true);assert.equal(label.source,source.replace('[label]','[新的]'));
 const url=set(source,p.from,p.to,'label','mailto:test@example.test');assert.equal(url.ok,true);assert.equal(url.source,"A [label](<mailto:test@example.test> 'Keep title') Z");
 assert.equal(inverse(url),source);
});
test('unsafe URL schemes, control characters, injection and malformed inputs are rejected',()=>{
 for(const href of ['javascript:alert(1)','data:text/html,x','file:///tmp/x','//server/path','/tmp/x','https://user:pass@example.test',' https://example.test','https://example.test/a b','https://example.test/<x>','x\n)\n# bad','mailto:a@b?subject=%0aInjected','\\server','https://'])
  assert.equal(set('word',1,5,'word',href).ok,false,href);
 for(const label of ['', '  ', '**bold**','[nested](x)','x\ny','a\u0000b','x\ud800'])assert.equal(set('word',1,5,label,'https://example.test').ok,false,label);
 assert.equal(mapFormatEdit('word',{action:'bold',from:1,to:5,label:'bad',href:'https://example.test'}).ok,false);
 assert.equal(mapFormatEdit('word',{action:'set-link',from:1,to:5,label:'word',href:'#x',path:'/tmp/evil'}).ok,false);
});
test('cross-block, mixed marks and partial-surrogate selections cannot be linked',()=>{
 for(const [s,a,b] of [['First\n\nSecond',2,10],['**bold**',1,5],['A **bold** Z',2,6],['A😀B',3,3],['```md\ncode\n```',2,3]])assert.equal(set(s,a,b,'Link','#x').ok,false,s);
 const p=projectSource('A [label](x) Z').spans.find(s=>s.link);
 assert.equal(set('A [label](x) Z',p.from-1,p.to,'Link','#x').ok,false);
});
