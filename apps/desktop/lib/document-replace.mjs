import {Transform} from '@tiptap/pm/transform';
import capacity from './document-capacity.js';
import {projectSource} from './document-source-map.mjs';

// Plan the entire batch before submitting one existing source-edit operation.
// Exact source spans and a fresh projection prevent Markdown syntax changes.
export function planDocumentReplace(source, doc, matches, insert, selection = {from:1,to:1}) {
  const fail = code => ({ok:false,code});
  if (typeof insert !== 'string' || insert.length > 4096 || /[\0\r\n]/.test(insert)
      || !insert.isWellFormed() || !Array.isArray(matches) || !matches.length || matches.length > 1000) return fail('invalid-replacement');
  try {
    const projection = projectSource(source), schema = doc.type.schema;
    if (!doc.eq(schema.nodeFromJSON(projection.doc))) return fail('stale-replacement');
    const edits = []; let end = -1;
    for (const {from,to} of matches) {
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < end || to <= from) return fail('invalid-replacement');
      const span = projection.spans.find(s => from >= s.from && to <= s.to);
      if (!span) return fail('protected-replacement');
      const a=span.sourceFrom+from-span.from,b=span.sourceFrom+to-span.from;
      const text=source.slice(a,b);
      if (!text.isWellFormed() || text!==doc.textBetween(from,to,'','')) return fail('protected-replacement');
      edits.push({from,to,a,b}); end=to;
    }
    if (source.length+edits.reduce((n,e)=>n+insert.length-(e.b-e.a),0)>capacity.MAX_SOURCE_UNITS) return fail('invalid-replacement');
    const tr = new Transform(doc); let candidate=source;
    for (const e of edits.toReversed()) {
      candidate=candidate.slice(0,e.a)+insert+candidate.slice(e.b);
      const marks=doc.nodeAt(e.from)?.marks || [];
      tr.replaceWith(e.from,e.to,insert?schema.text(insert,marks):[]);
    }
    if (!tr.doc.eq(schema.nodeFromJSON(projectSource(candidate).doc))) return fail('protected-replacement');
    return {ok:true,source:candidate,count:edits.length,
      selection:{from:tr.mapping.map(selection.from),to:tr.mapping.map(selection.to)},
      selectionJSON:typeof selection.map==='function'?selection.map(tr.doc,tr.mapping).toJSON():null};
  } catch {return fail('protected-replacement');}
}
