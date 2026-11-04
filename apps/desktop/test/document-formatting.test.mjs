import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';
import { mapFormatEdit } from '../lib/document-format-edit.mjs';
const format = (source, action, text, start=0, end=start) => {
  const span=projectSource(source).spans.find(s=>s.text===text); assert.ok(span, text);
  return mapFormatEdit(source,{action,from:span.from+start,to:span.from+end});
};
for(const nl of ['\n','\r\n','\r']) test(`formatting: headings/bold/list preserve untouched bytes ${JSON.stringify(nl)}`,()=>{
  const original=['---','keep: yes','---','','First 中文😀.','','```md','[opaque](x)','```',''].join(nl);
  const title=format(original,'heading-2','First 中文😀.'); assert.equal(title.ok,true); assert.equal(title.source,original.replace('First','## First'));
  const plain=format(title.source,'paragraph','First 中文😀.'); assert.equal(plain.source,original);
  const bold=format(original,'bold','First 中文😀.',6,10); assert.equal(bold.ok,true); assert.equal(bold.source,original.replace('中文😀','**中文😀**'));
  const unbold=format(bold.source,'bold','中文😀',0,4); assert.equal(unbold.source,original);
  const list=format(bold.source,'bullet-list','First '); assert.equal(list.ok,true); assert.equal(list.source,bold.source.replace('First','- First'));
  assert.equal(format(list.source,'paragraph','First ').source,bold.source);
  assert.equal(mapTextEdit(list.source,{from:projectSource(list.source).spans.find(s=>s.bold).from,to:projectSource(list.source).spans.find(s=>s.bold).to,insert:'新字'}).ok,true);
});
test('formatting: list text, split, join, empty item exit and type conversion',()=>{
  let s='First word.\r\n\r\nTail.\r\n';
  s=format(s,'bullet-list','First word.').source; assert.equal(s,'- First word.\r\n\r\nTail.\r\n');
  s=format(s,'split-list','First word.',6).source; assert.equal(s,'- First \r\n- word.\r\n\r\nTail.\r\n');
  s=format(s,'join-list','word.').source; assert.equal(s,'- First word.\r\n\r\nTail.\r\n');
  s=format(s,'split-list','First word.',11).source; assert.equal(s,'- First word.\r\n- \r\n\r\nTail.\r\n');
  s=format(s,'split-list','').source; assert.equal(s,'- First word.\r\n\r\n\r\n\r\nTail.\r\n');
  const numbered=format('- A\r\n- B','ordered-list','A'); assert.equal(numbered.source,'1. A\r\n2. B');
  assert.equal(format(numbered.source,'paragraph','A').source,'A\r\n\r\nB');
});
test('formatting rejects unsupported structure, cross blocks, blank bold and unsafe payloads',()=>{
  for(const source of ['```md\nfoo\n```','- one\n  - nested','- [ ] task','line\nwrapped','Title\n===','[link](x)']){
    assert.equal(mapFormatEdit(source,{action:'heading-1',from:1,to:1}).ok,false,source);
  }
  for(const change of [{action:'bold',from:1,to:1},{action:'bold',from:1,to:3},{action:'heading-1',from:1,to:10},{action:'html',from:1,to:1},{action:'paragraph',from:1,to:1,path:'/tmp/x'}]) assert.equal(mapFormatEdit(' A \n\nTail.',change).ok,false,JSON.stringify(change));
  assert.equal(format('A 😀 B','bold','A 😀 B',3,4).ok,false);
  assert.equal(format('A & B','bold','A & B',0,4).ok,false); // trailing whitespace
  assert.equal(format('A **bold** B','bold','bold',1,2).ok,false); // no partial removal in V1
});

test('heading Enter creates a paragraph and preserves following source and CRLF',()=>{
  const r=format('## Heading\r\n\r\nTail.\r\n','split-heading','Heading',7);
  assert.equal(r.ok,true);assert.equal(r.source,'## Heading\r\n\r\n\r\n\r\nTail.\r\n');
  assert.equal(r.projection.doc.content[1].type,'paragraph');assert.deepEqual(r.projection.doc.content[1].content,[]);
});

test('flat list marker variants keep unmodified spelling; complex lists remain opaque',()=>{
  for(const marker of ['- ','+ ','* ','3. ','3) '])for(const nl of ['\n','\r\n']){
    const source=marker+'First'+nl+marker+'Second'+nl;
    const p=projectSource(source);assert.equal(p.spans.length,2);
    const edited=mapTextEdit(source,{from:p.spans[1].from,to:p.spans[1].to,insert:'第二😀'});
    assert.equal(edited.ok,true);assert.equal(edited.source,source.replace('Second','第二😀'));
    const split=format(source,'split-list','First',5);assert.equal(split.ok,true,JSON.stringify({marker,nl}));
    assert.ok(split.source.endsWith(marker+'Second'+nl));
    assert.equal(format(source,'paragraph','First').source,'First'+nl+nl+'Second'+nl);
  }
  for(const source of ['- a\n\n- b','- a\n  continuation','- a\n  - nested','- [x] task','- [link](x)','- a  \n  b','- `code`']) assert.equal(projectSource(source).doc.content[0].type,'codeBlock',source);
});
test('format source inverse exactly restores accepted byte ranges over a small boundary matrix',()=>{
  let accepted=0;
  for(const text of ['Word','中文😀','é test','A [bracket]','**bold** tail'])for(const nl of ['\n','\r\n']){
    const source='```\nkeep\n```'+nl+nl+text+nl+nl+'End.'+nl;
    const p=projectSource(source);
    for(const span of p.spans.filter(s=>s.blockIndex===1))for(const action of ['paragraph','heading-1','heading-3','bullet-list','ordered-list','bold']){
      const result=mapFormatEdit(source,{action,from:span.from,to:span.to});if(!result.ok)continue;
      accepted++;const c=result.inverseSource;
      assert.equal(result.source.slice(0,c.from)+c.insert+result.source.slice(c.to),source);
      assert.ok(result.source.startsWith('```\nkeep\n```'+nl+nl));assert.ok(result.source.endsWith(nl+nl+'End.'+nl));
    }
  }
  assert.ok(accepted>40);
});
