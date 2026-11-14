import {planSoftRange} from './document-soft-edit.mjs';
import {Transform} from '@tiptap/pm/transform';
import capacity from './document-capacity.js';
import {planInlineRange} from './document-inline-source.mjs';
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
    const edits = []; let end = -1, planningWork = 0;
    for (const {from,to} of matches) {
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < end || to <= from) return fail('invalid-replacement');
      const span = projection.spans.find(s => from >= s.from && to <= s.to);
      if (!span || ((span.bold||span.italic||span.code||span.link) && from===span.from && to===span.to && !insert)) {
        planningWork+=source.length;
        if(planningWork>32_000_000)return fail('replacement-budget');
        const planned=planInlineRange(source,projection,{from,to,insert})||planSoftRange(source,projection,{from,to,insert});
        if(!planned?.ok)return fail('protected-replacement');
        edits.push({from,to,a:planned.change.from,b:planned.change.to,text:planned.change.insert});end=to;continue;
      }
      const a=span.sourceFrom+from-span.from,b=span.sourceFrom+to-span.from;
      const text=source.slice(a,b);
      if (!text.isWellFormed() || text!==doc.textBetween(from,to,'','')) return fail('protected-replacement');
      edits.push({from,to,a,b,text:insert}); end=to;
    }
    const overlap=edits.some((e,i)=>i>0&&edits[i-1].b>e.a);
    // Overlapping delimiter patches require descending re-planning. Bound work
    // before starting so dense near-capacity documents cannot freeze the UI.
    if(overlap && source.length*matches.length>32_000_000)return fail('replacement-budget');
    if (source.length+edits.reduce((n,e)=>n+e.text.length-(e.b-e.a),0)>capacity.MAX_SOURCE_UNITS) return fail('invalid-replacement');
    const tr = new Transform(doc); let candidate=source, work=0;
    for (const e of edits.toReversed()) {
      if(overlap){
        work+=candidate.length;if(work>32_000_000)return fail('replacement-budget');
        const current=projectSource(candidate),span=current.spans.find(s=>e.from>=s.from&&e.to<=s.to);
        const raw=span && insert && {from:span.sourceFrom+e.from-span.from,to:span.sourceFrom+e.to-span.from,insert};
        const planned=planInlineRange(candidate,current,{from:e.from,to:e.to,insert})||planSoftRange(candidate,current,{from:e.from,to:e.to,insert});
        if(planned?.ok)candidate=planned.source;
        else if(raw)candidate=candidate.slice(0,raw.from)+insert+candidate.slice(raw.to);
        else return fail('protected-replacement');
      }else candidate=candidate.slice(0,e.a)+e.text+candidate.slice(e.b);
      const marks=doc.nodeAt(e.from)?.marks || [];
      tr.replaceWith(e.from,e.to,insert?schema.text(insert,marks):[]);
    }
    if (!tr.doc.eq(schema.nodeFromJSON(projectSource(candidate).doc))) return fail('protected-replacement');
    return {ok:true,source:candidate,count:edits.length,
      selection:{from:tr.mapping.map(selection.from),to:tr.mapping.map(selection.to)},
      selectionJSON:typeof selection.map==='function'?selection.map(tr.doc,tr.mapping).toJSON():null};
  } catch {return fail('protected-replacement');}
}
