import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { documentEditorExtensions } from '../lib/document-editor-extensions.mjs';
import { projectSource } from '../lib/document-source-map.mjs';
import { defaultReading, changeReading, documentHeadings, createReadingView, activeHeadingIndex } from '../lib/document-reading-view.mjs';
const schema = getSchema(documentEditorExtensions());
const projected = source => schema.nodeFromJSON(projectSource(source).doc);

test('reading options accept only declared display values and preserve defaults', () => {
  const result = changeReading(defaultReading, 'theme', 'dark');
  assert.equal(result.theme, 'dark'); assert.equal(defaultReading.theme, 'light');
  assert.deepEqual(changeReading(result, 'size', '21'), { ...result, size: '21' });
  for (const [key, value] of [['size','10000'],['font','url(https://example.invalid)'],['width','auto'],['theme','auto'],['__proto__','x'],['path','/tmp']])
    assert.equal(changeReading(result, key, value), result);
});
test('outline uses supported headings including links and excludes code, nested headings and frontmatter', () => {
  const source = '\ufeff---\r\nsecret: synthetic\r\n---\r\n# 中文 **标题**\r\n\r\n```md\n# Code heading\n```\n\n## Same\n\n## Same\n\n### [link](https://example.invalid)\n\n> # Nested\n';
  const doc = projected(source.slice(1)), before = doc.toJSON(), rows = documentHeadings(doc);
  assert.deepEqual(rows.map(r => [r.level,r.title]), [[1,'中文 标题'],[2,'Same'],[2,'Same'],[3,'link']]);
  assert.equal(new Set(rows.map(r => r.position)).size, 4);
  for (const row of rows) assert.equal(doc.nodeAt(row.position).textContent, row.title);
  assert.deepEqual(doc.toJSON(), before); assert.equal(documentHeadings(projected('Only paragraph.')).length, 0);
});
test('outline handles levels one to six and literal text without inventing IDs from titles', () => {
  const doc = schema.node('doc', null, [1,2,3,4,5,6].map(level => schema.node('heading',{level},schema.text('<button>同名</button>'))));
  const rows = documentHeadings(doc);
  assert.deepEqual(rows.map(r => r.level), [1,2,3,4,5,6]);
  assert.equal(rows.every(r => r.title === '<button>同名</button>'), true);
  assert.equal(new Set(rows.map(r => r.position)).size, 6);
});

function fixture(t) {
  t.mock.method(globalThis, 'requestAnimationFrame', fn => fn());
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { dataset:{}, attrs:{}, children:[], style:{setProperty(){}}, value:'', hidden:false, disabled:false,
      setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this[k]=fn;},replaceChildren(...children){this.children=children;},
      showModal(){this.open=true;},close(){this.open=false;this.closeEvent?.();},focus(){},
      getBoundingClientRect(){return {top:0};} });
    return nodes.get(id);
  };
  let seq=0;
  const doc = { body:node('body'), createElement:()=>node('generated-'+(++seq)),addEventListener(){},querySelector:()=>null };
  const byId=id=>{const n=node(id);n.ownerDocument=doc;return n;};
  const source='# Original\n\n## Second\n';
  const c={loading:false,invalid:false,state:{confirmed:{sessionId:'a',source},source,pending:0,revision:0}};
  const headingDOM=new Map();
  c.editor={state:{doc:projected(source)},view:{dom:{contains:()=>true},nodeDOM:pos=>headingDOM.get(pos)}};
  for (const item of documentHeadings(c.editor.state.doc)) headingDOM.set(item.position,{nodeName:'H'+item.level,getBoundingClientRect:()=>({top:400})});
  const scroll=byId('document-scroll');scroll.scrollTop=0;scroll.scrollHeight=1000;scroll.clientHeight=300;
  scroll.scrollTo=({top})=>{scroll.scrollTop=top;scroll.calls=(scroll.calls||0)+1;};
  const view=createReadingView({byId,context:()=>c});view.configure();
  return {c,byId,view,scroll};
}
// Node has no renderer frame loop; only the presentation callback is substituted.
globalThis.requestAnimationFrame ||= () => {};
test('outline navigation only scrolls, and guards composition, pending, invalid and locked states', t => {
  const {c,byId,view,scroll}=fixture(t), row=byId('outline-list').children[1], original=c.editor.state.doc;
  row.onclick();assert.equal(scroll.calls,1);assert.equal(c.editor.state.doc,original);assert.equal(c.state.revision,0);
  for(const field of ['pending','composing','compositionInvalid','historyPending','locked']) {
    c.state[field]=1;view.sync();row.onclick();assert.equal(scroll.calls,1);c.state[field]=0;
  }
  c.loading=true;view.sync();row.onclick();assert.equal(scroll.calls,1);c.loading=false;
  c.invalid=true;view.sync();row.onclick();assert.equal(scroll.calls,1);c.invalid=false;
  view.sync();row.onclick();assert.equal(scroll.calls,2);
});
test('stale outline row cannot navigate another session or an unconfirmed replacement document', t => {
  const {c,byId,view,scroll}=fixture(t), stale=byId('outline-list').children[0];
  c.state.confirmed={...c.state.confirmed,sessionId:'b'};stale.onclick();assert.equal(scroll.calls,undefined);
  view.sync();stale.onclick();assert.equal(scroll.calls,undefined);
  byId('outline-list').children[0].onclick();assert.equal(scroll.calls,1);
  const second=byId('outline-list').children[0];
  c.editor.state.doc=projected('# Changed\n');c.state.source='# Changed\n';second.onclick();assert.equal(scroll.calls,1);
  c.state.confirmed={sessionId:'b',source:c.state.source};view.sync();second.onclick();assert.equal(scroll.calls,1);
  assert.equal(byId('outline-list').children[0].textContent,'Changed');
});
test('opening settings during composition is refused; display choices leave content and revision intact', t => {
  const {c,byId,view}=fixture(t), before=structuredClone(c.state), original=c.editor.state.doc;
  c.state.composing=true;view.sync();byId('show-reading-settings').onclick();assert.notEqual(byId('reading-settings-dialog').open,true);
  c.state.composing=false;view.sync();byId('show-reading-settings').onclick();assert.equal(byId('reading-settings-dialog').open,true);
  byId('reading-theme-dark').onclick();assert.equal(byId('body').dataset.readingTheme,'dark');
  byId('reading-size').value='21';byId('reading-size').onchange();assert.equal(byId('reading-size').value,'21');
  byId('reset-reading-settings').onclick();assert.equal(byId('reading-size').value,'17');
  assert.equal(c.editor.state.doc,original);assert.deepEqual({...c.state,composing:undefined},{...before,composing:undefined});
});


test('closing the last document clears outline rows and stale navigation', t => {
  const {c,byId,view,scroll}=fixture(t), stale=byId('outline-list').children[0];
  c.state=undefined; c.editor=null; view.sync();
  assert.equal(byId('outline-list').children.length,0); stale.onclick();
  assert.equal(scroll.calls,undefined);
});


test('active heading lookup is logarithmic for a large ordered outline', () => {
  let reads=0;
  assert.equal(activeHeadingIndex(4096, index => { reads++; return index * 100; }, 205050),2050);
  assert.ok(reads<=13,`layout reads: ${reads}`);
  assert.equal(activeHeadingIndex(0,()=>{throw Error('no headings');},0),-1);
  assert.equal(activeHeadingIndex(3,i=>i*100,-10),0);
  assert.equal(activeHeadingIndex(3,i=>i*100,999),2);
});
test('outline filtering is literal, preserves source and resets across sessions', t => {
  const {c,byId,view,scroll}=fixture(t), before=structuredClone(c.state);
  byId('outline-filter').value='SECOND';byId('outline-filter').oninput();
  assert.equal(byId('outline-list').children[0].hidden,true);
  assert.equal(byId('outline-list').children[1].hidden,false);
  assert.equal(byId('outline-count').textContent,'1 / 2');
  byId('outline-filter').onkeydown({key:'Enter',preventDefault(){}});assert.equal(scroll.calls,1);
  byId('outline-filter').value='.*';byId('outline-filter').oninput();
  assert.equal(byId('outline-empty').textContent,'没有匹配的标题。');
  assert.deepEqual(c.state,before);
  c.state.confirmed={...c.state.confirmed,sessionId:'b'};view.sync();
  assert.equal(byId('outline-filter').value,'');assert.equal(byId('outline-count').textContent,'2');
});
test('outline navigation waits for native composition even before controller catches up', t => {
  const {c,byId,view,scroll}=fixture(t);c.editor.view.composing=true;view.sync();
  byId('outline-list').children[0].onclick();assert.equal(scroll.calls,undefined);
});


test('outline filter composition cannot jump on the candidate confirmation key', t => {
  const {byId,scroll}=fixture(t), input=byId('outline-filter');
  input.oncompositionstart();input.value='Second';input.oninput();
  input.onkeydown({key:'Enter',preventDefault(){throw Error('candidate key consumed');}});
  assert.equal(scroll.calls,undefined);input.oncompositionend();
  assert.equal(byId('outline-count').textContent,'1 / 2');
  input.onkeydown({key:'Enter',preventDefault(){}});assert.equal(scroll.calls,1);
});


test('body edits retain outline DOM, update positions and still refuse unconfirmed navigation',t=>{
 const {c,byId,view,scroll}=fixture(t),first=byId('outline-list').children[0],second=byId('outline-list').children[1];
 const source='# Original\n\nNew body text.\n\n## Second\n';
 const doc=projected(source);c.editor.state.doc=doc;c.state.source=source;
 second.onclick();assert.equal(scroll.calls,undefined);
 view.sync();assert.equal(byId('outline-list').children[1],second);
 c.state.confirmed={...c.state.confirmed,source};
 const calls=[];c.editor.view.nodeDOM=pos=>{calls.push(pos);return {nodeName:'H2',getBoundingClientRect:()=>({top:700})};};
 view.sync();assert.equal(byId('outline-list').children[0],first);assert.equal(byId('outline-list').children[1],second);
 calls.length=0;second.onclick();assert.ok(calls.includes(documentHeadings(doc)[1].position));assert.equal(scroll.calls,1);
 c.state.confirmed={...c.state.confirmed,sessionId:'other'};view.sync();second.onclick();assert.equal(scroll.calls,1);
 assert.notEqual(byId('outline-list').children[1],second);
});
