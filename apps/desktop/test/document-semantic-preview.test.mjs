import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';

const schema=getSchema(documentEditorExtensions());
test('a leading rule is displayed unless a complete frontmatter frame is present',()=>{
 const source='---\n\nAfter';
 const p=projectSource(source);assert.equal(p.doc.content[0].type,'documentPreview');
 assert.equal(p.doc.content[0].attrs.kind,'horizontalRule');assert(p.spans.some(s=>s.text==='After'));
 const frontmatter=projectSource('---\ntitle: Keep\n---\n\nAfter');
 assert.equal(frontmatter.doc.content[0].type,'codeBlock');
 assert.match(frontmatter.doc.content[0].content[0].text,/title: Keep/);
});
test('rules, decoded text, autolinks and reference links display semantically without editable source claims',()=>{
 const cases=[['---','horizontalRule'],['Escaped \\*star\\* and &amp; entity.','paragraph'],
  ['Visit <https://example.test> or www.example.test.','paragraph'],
  ['[Label][ref]\n\n[ref]: https://example.test "Keep"','paragraph'],
  ['> Outer\n>\n> > Nested\n>\n> - child','blockquote']];
 for(const [source,kind] of cases){
  const p=projectSource(source),preview=p.doc.content.find(n=>n.type==='documentPreview');
  assert(preview,source);assert.equal(preview.attrs.kind,kind);
  assert.equal(schema.nodeFromJSON(p.doc).firstChild.nodeSize,1);
  assert.equal(p.spans.length,0);
  assert.equal(mapTextEdit(source,{from:0,to:1,insert:'replace'}).ok,false);
 }
 const escaped=projectSource(cases[1][0]).doc.content[0].attrs.tree;
 assert.match(JSON.stringify(escaped),/Escaped \*star\* and & entity/);
 const ref=projectSource(cases[3][0]);assert.equal(ref.doc.content.length,1);
 assert.match(JSON.stringify(ref.doc),/https:\/\/example.test/);
});
test('references resolve definitions inside containers without displaying definition syntax',()=>{
 const p=projectSource('[Label][id]\n\n> [id]: https://example.test/nested\n>\n> Quote');
 const reference=p.doc.content[0];assert.equal(reference.type,'documentPreview');
 assert.match(JSON.stringify(reference.attrs.tree),/https:\/\/example.test\/nested/);
 assert(!JSON.stringify(p.doc).includes('[id]:'));
});
test('semantic previews retain neighboring exact edits and never execute HTML or fetch images',()=>{
 const source='Before\r\n\r\nEscaped \\*text\\* &amp;.\r\n\r\nAfter';
 const p=projectSource(source),span=p.spans.find(s=>s.text==='After');
 const r=mapTextEdit(source,{from:span.to,to:span.to,insert:'!'});
 assert(r.ok);assert.equal(r.source,source+'!');
 assert.deepEqual(r.projection.doc.content[1],p.doc.content[1]);
 const html=projectSource('<script>alert(1)</script>').doc.content[0];
 assert.equal(html.type,'codeBlock');
 const nested=projectSource('> [text](javascript:alert(1))\n>\n> - ![remote](https://example.test/x.png)').doc;
 const text=JSON.stringify(nested);assert(!text.includes('"type":"image"'));
 const preview=nested.content.find(n=>n.type==='documentPreview');assert(preview);
 const spec=JSON.stringify(schema.nodes.documentPreview.spec.toDOM(schema.nodeFromJSON(preview)));
 assert.doesNotMatch(spec,/"(?:href|src|onclick)":/);
 assert.doesNotMatch(spec,/\["(?:script|img|iframe)"/);
});
