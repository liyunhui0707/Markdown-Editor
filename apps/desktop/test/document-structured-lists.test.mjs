import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
const run=(source,action,index=0,offset=0)=>{const p=projectSource(source),r=p.blocks[0]?.items?.[index];assert.ok(r,'editable list');return mapFormatEdit(source,{action,from:r.from+offset,to:r.from+offset});};
const changed=(source,action,index,offset,want)=>{const r=run(source,action,index,offset);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.source,want);const c=r.inverseSource;assert.equal(r.source.slice(0,c.from)+c.insert+r.source.slice(c.to),source);return r;};
test('task and mixed nested lists project exact source positions without touching CRLF or markers',()=>{
 const s='- [x] Parent\r\n  1) **Child**\r\n  2) [ ] Next\r\n- Tail';const p=projectSource(s);
 assert.equal(p.doc.content[0].type,'bulletList');assert.equal(p.blocks[0].items.length,4);
 assert.equal(p.doc.content[0].content[0].attrs.checked,true);
 for(const span of p.spans)assert.equal(s.slice(span.sourceFrom,span.sourceTo),span.text);
 const span=p.spans.find(s=>s.text==='Child');const edit=mapTextEdit(s,{from:span.from,to:span.to,insert:'中文😀'});assert.equal(edit.ok,true);assert.equal(edit.source,s.replace('Child','中文😀'));
});
test('task toggle changes one character and retains exact inverse, task split starts unchecked',()=>{
 changed('- [X] Alpha','toggle-task',0,2,'- [ ] Alpha');
 changed('- [ ] Alpha','toggle-task',0,2,'- [x] Alpha');
 changed('- [x] Alpha','split-list',0,5,'- [x] Alpha\n- [ ] ');
});
test('task shortcut and toolbar creation',()=>{
 changed('- [ ]','task-shortcut',0,3,'- [ ] ');
 changed('- Hello','task-list',0,2,'- [ ] Hello');
 const r=mapFormatEdit('Hello',{action:'task-list',from:2,to:2});assert.equal(r.source,'- [ ] Hello');
});
test('indent moves a subtree, outdent restores it and preserves numbered marker spelling',()=>{
 const a='- One\n- Two\n  1) Kid\n- Three',b='- One\n  - Two\n    1) Kid\n- Three';
 changed(a,'indent-list',1,1,b);changed(b,'outdent-list',1,1,a);
});
test('outdent middle child adopts following siblings, no content is dropped',()=>{
 changed('- A\n  - B\n  - C\n- D','outdent-list',1,0,'- A\n- B\n  - C\n- D');
});
test('nested Enter, empty item outdent and boundary merge',()=>{
 changed('- A\n  - [x] BC','split-list',1,1,'- A\n  - [x] B\n  - [ ] C');
 changed('- A\n  - [ ] ','split-list',1,0,'- A\n- [ ] ');
 changed('- A\n  - B\n  - C','join-list',2,0,'- A\n  - BC');
});
test('cross sibling nested text replacement preserves nesting and task state',()=>{
 const s='- A\n  - [x] ABC\n  - [ ] DEF\n- Z',p=projectSource(s),rows=p.blocks[0].items;
 const r=mapTextEdit(s,{from:rows[1].from+1,to:rows[2].from+2,insert:'新'});
 assert.equal(r.ok,true);assert.equal(r.source,'- A\n  - [x] A新F\n- Z');
 assert.equal(mapTextEdit(s,{from:rows[0].from,to:rows[2].to,insert:'NO'}).ok,false);
});
test('loose, multiline, excessive depth and oversized list structures remain protected',()=>{
 for(const s of ['- A\n\n- B','- A\n  continuation','- A\n  ```js\n  code\n  ```',Array.from({length:7},(_,i)=>'  '.repeat(i)+'- A').join('\n')])assert.equal(projectSource(s).doc.content[0].type,'codeBlock');
 assert.equal(run('- A','indent-list').ok,false);
});


test('ordered indentation emits unambiguous CommonMark; empty interruption stays refused',()=>{
 assert.equal(run('- A\n- ','indent-list',1,0).ok,false);
 changed('1. A\n2. B','indent-list',1,1,'1. A\n   1. B');
});
for(const nl of ['\n','\r\n','\r'])test('task subtree operations preserve file neighbors '+JSON.stringify(nl),()=>{
 const base=['# Keep','','- [X] A','  - **B**','- [ ] C','','```js','literal','```',''].join(nl);
 const p=projectSource(base),r=p.blocks[1].items[1];
 const change=mapFormatEdit(base,{action:'bold',from:r.from,to:r.to});assert.equal(change.ok,true);assert.equal(change.source,base.replace('**B**','B'));
 const toggle=mapFormatEdit(base,{action:'toggle-task',from:p.blocks[1].items[0].from,to:p.blocks[1].items[0].from});assert.equal(toggle.source,base.replace('[X]','[ ]'));
 const inverse=toggle.inverseSource;assert.equal(toggle.source.slice(0,inverse.from)+inverse.insert+toggle.source.slice(inverse.to),base);
});
test('list capacity, depth, payload and noncollapsed structural commands refuse atomically',()=>{
 const source=Array.from({length:32},(_,i)=>'- [ ] Task'+i).join('\n');
 assert.equal(run(source,'split-list',31,6).ok,false);
 const deep=Array.from({length:6},(_,i)=>'  '.repeat(i)+'- A').join('\n');assert.equal(projectSource(deep).blocks[0].items.length,6);
 const r=projectSource('- [ ] A').blocks[0].items[0];
 for(const command of [{action:'toggle-task',from:r.from,to:r.to},{action:'toggle-task',from:r.from,to:r.from,source:'injected'},{action:'indent-list',from:-1,to:-1}])assert.equal(mapFormatEdit('- [ ] A',command).ok,false);
});
