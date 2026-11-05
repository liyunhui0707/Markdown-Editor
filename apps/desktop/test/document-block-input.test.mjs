import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSource, mapTextEdit } from '../lib/document-source-map.mjs';
import { mapFormatEdit } from '../lib/document-format-edit.mjs';

const shortcut = (source, marker) => {
  const span = projectSource(source).spans.find(s => s.text.startsWith(marker));
  assert.ok(span, marker);
  return mapFormatEdit(source, {action:'block-shortcut',from:span.from+marker.length,to:span.from+marker.length});
};
for (const marker of ['#','##','###','####','#####','######','-','+','*','1.','3)','0.','001.','123456789.']) {
  test(`typing ${marker}, space, text preserves source and exact inverse`, () => {
    let source='';
    for (const char of marker) {
      const span=projectSource(source).spans[0];
      const r=mapTextEdit(source,{from:span.to,to:span.to,insert:char});
      assert.equal(r.ok,true,source+char);source=r.source;
    }
    const r=shortcut(source,marker); assert.equal(r.ok,true);assert.equal(r.source,marker+' ');
    assert.equal(r.source.slice(0,r.inverseSource.from)+r.inverseSource.insert+r.source.slice(r.inverseSource.to),source);
    const typed=mapTextEdit(r.source,{...r.selection,insert:'Title 中文😀'});
    assert.equal(typed.ok,true);assert.equal(typed.source,marker+' Title 中文😀');
    const span=typed.projection.spans[0],cleared=mapTextEdit(typed.source,{from:span.from,to:span.to,insert:''});
    assert.equal(cleared.ok,true);assert.equal(cleared.source,marker+' ');
  });
}
for(const nl of ['\n','\r\n','\r']) test(`shortcut preserves unrelated syntax and ${JSON.stringify(nl)}`,()=>{
  const source=['---','keep: yes','---','','#Title','','```md','opaque','```',''].join(nl);
  const r=shortcut(source,'#');assert.equal(r.ok,true);assert.equal(r.source,source.replace('#Title','# Title'));
  assert.equal(r.selection.from,r.projection.spans.find(s=>s.text==='Title').from);
});
test('shortcut rejects selections, mid-line prefixes, protected blocks and payload expansion',()=>{
  for(const [source,from,to] of [['word #',7,7],['#',1,2],['#######',8,8],['1000000000.',12,12],['> quote',2,2],['`#`',2,2],['- one\n  - nested',2,2]])
    assert.equal(mapFormatEdit(source,{action:'block-shortcut',from,to}).ok,false,source);
  assert.equal(mapFormatEdit('#',{action:'block-shortcut',from:2,to:2,source:'# injected'}).ok,false);
  assert.equal(projectSource('---').doc.content[0].type,'codeBlock');
});
test('all heading levels work in an empty paragraph and can return to a paragraph',()=>{
  for(let level=1;level<=6;level++){
    const r=mapFormatEdit('',{action:'heading-'+level,from:1,to:1});assert.equal(r.ok,true);
    assert.equal(r.source,'#'.repeat(level)+' ');assert.equal(r.projection.doc.content[0].attrs.level,level);
    assert.equal(mapFormatEdit(r.source,{action:'paragraph',...r.selection}).source,'');
  }
});
