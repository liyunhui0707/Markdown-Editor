import test from 'node:test';
import assert from 'node:assert/strict';
import {projectInlineLeaf} from '../lib/document-inline-leaf.mjs';
import {projectSource, mapTextEdit} from '../lib/document-source-map.mjs';

const leaf = text => projectInlineLeaf({type:'text', value:text,
  position:{start:{offset:0},end:{offset:text.length}}}, text);

test('every lone UTF-16 surrogate is refused in source leaves and inserted text', () => {
  for (let unit=0xd800; unit<=0xdfff; unit++) {
    const lone=String.fromCharCode(unit);
    for (const text of [lone, '中文'+lone, lone+'😀', '😀'+lone+'e\u0301']) {
      assert.equal(leaf(text), null);
      assert.equal(mapTextEdit('plain', {from:2,to:2,insert:text}).ok, false);
    }
  }
});

test('valid supplementary characters, ZWJ and combining sequences retain exact source ranges', () => {
  const samples=['e\u0301','👩🏽‍💻','🇨🇳','中文😀'];
  // Each high and low surrogate is exercised as part of a valid pair.
  for (let n=0;n<1024;n++) samples.push(String.fromCharCode(0xd800+n,0xdc00+n));
  for (const text of samples) {
    const span=leaf('a'+text+'z');
    assert.equal(span.text, 'a'+text+'z');
    assert.equal(span.sourceTo, text.length+2);
  }
  for (const nl of ['\n','\r\n','\r']) for (const text of samples.slice(0,4)) {
    const source='# Heading'+nl+nl+'before '+text+' after'+nl;
    const span=projectSource(source).spans[1];
    const mapped=mapTextEdit(source,{from:span.to,to:span.to,insert:' '+text});
    assert.equal(mapped.ok,true);
    assert.equal(mapped.source,source.slice(0,span.sourceTo)+' '+text+source.slice(span.sourceTo));
    const undone=mapTextEdit(mapped.source,{from:span.to,to:span.to+1+text.length,insert:''},mapped.leaf);
    assert.equal(undone.source,source);
  }
});

test('NUL, newlines and edits that split an existing pair stay refused', () => {
  for (const text of ['\0','a\0b','a\nb','a\rb']) assert.equal(leaf(text),null);
  for (const text of ['\0','a\0b','a\rb']) assert.equal(mapTextEdit('plain',{from:2,to:2,insert:text}).ok,false);
  const source='a😀z',span=projectSource(source).spans[0];
  for (const change of [{from:span.from+2,to:span.from+2,insert:'x'},
    {from:span.from+1,to:span.from+2,insert:''},{from:span.from+2,to:span.from+3,insert:''}]) {
    assert.equal(mapTextEdit(source,change).ok,false);
  }
});
