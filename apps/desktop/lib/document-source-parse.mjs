// A two-revision parse cache. Isolated inline paragraphs, headings and owned list/quote text can
// reuse surrounding AST nodes. Projection and edit validation still inspect the
// complete document; uncertain syntax always goes through the complete parser.
export function createSourceParser(parseFull) {
  const cached = new Map();
  const blankGap = text => /^[\r\n]+$/.test(text) && text.replaceAll('\r\n', '\n').length >= 2;
  const inline = (node, source, depth=0) => {
    if(depth>6||!node.position?.start||!node.position?.end)return false;
    if(node.type==='text')return !/[\[\]<\\|]/.test(source.slice(node.position.start.offset,node.position.end.offset));
    if(['inlineCode','break'].includes(node.type))return true;
    if(node.type==='link'&&source[node.position.start.offset]!=='[')return false; // Keep bare/angle autolinks conservative.
    return ['strong','emphasis','delete','link'].includes(node.type)&&node.children?.length>0&&node.children.every(n=>inline(n,source,depth+1));
  };
  const supported = (node, source, depth=0) => {
    if(depth>16||!node.children?.length)return false;
    if(['paragraph','heading'].includes(node.type))return node.children.every(n=>inline(n,source));
    if(node.type==='list')return node.children.every(n=>n.type==='listItem'&&supported(n,source,depth+1));
    if(node.type==='listItem')return node.children.length<=2&&node.children[0].type==='paragraph'
      &&(node.children.length===1||node.children[1].type==='list')&&node.children.every(n=>supported(n,source,depth+1));
    if(node.type==='blockquote')return node.children.every(n=>n.type==='paragraph'&&supported(n,source,depth+1));
    return false;
  };
  const isolated = (node, text, source) => node?.position?.start.column===1
    &&(!['paragraph','heading'].includes(node.type)||node.position.start.line===node.position.end.line)
    &&text.length>0&&supported(node,source);
  // Container structure and flags (numbering, checked, spread, heading depth)
  // must stay unchanged. Only inline content may differ in this fast path.
  const shape = node => {
    const {position,children,...rest}=node;
    return ['paragraph','heading'].includes(node.type)?rest:{...rest,children:children.map(shape)};
  };
  function ownsInlineChange(node,from,to){
    const pending=[node];while(pending.length){const n=pending.pop();
      if(['text','inlineCode'].includes(n.type)&&n.position&&from>=n.position.start.offset&&to<=n.position.end.offset)return true;
      if(n.children)pending.push(...n.children);
    }return false;
  }
  function literalMargin(node,raw,nextRaw,before,source,from,to,end,oldMargin,newMargin){
    const last=node.children?.at(-1),changed=before.slice(from,to)+source.slice(from,end);
    // A bounded isolated single-line paragraph may change its ASCII-space
    // margin only through its final exact text leaf. No tab, delimiter or
    // reference syntax is introduced/removed. Old-global proof, new fragment
    // kind/end/inline checks and blank outer boundaries below still apply.
    return node.type==='paragraph'&&node.position.start.line===node.position.end.line
      &&raw.length<=4096&&nextRaw.length<=4096&&last?.type==='text'
      &&from>=last.position.start.offset&&to<=node.position.end.offset
      &&before.slice(last.position.start.offset,last.position.end.offset)===last.value
      &&!oldMargin.includes('\t')&&!newMargin.includes('\t')&&changed.isWellFormed()
      &&!/[\t\r\n`*_~\[\]<>\\|]/.test(changed);
  }
  function freezeGraph(tree){
    const pending=[tree];
    while(pending.length){
      const value=pending.pop();if(!value||typeof value!=='object'||Object.isFrozen(value))continue;
      for(const child of Object.values(value))pending.push(child);Object.freeze(value);
    }
    return tree;
  }
  function freezePoint(point){
    // Standard points have only scalar fields. Preserve deep immutability for
    // extension metadata too, without walking the entire relocated AST again.
    for(const key in point){
      if(!Object.hasOwn(point,key))continue;
      const value=point[key];if(value&&typeof value==='object')freezeGraph(value);
    }
    return Object.freeze(point);
  }
  function translate(value, point) {
    if (Array.isArray(value)) return Object.freeze(value.map(v => translate(v, point)));
    if (!value || typeof value !== 'object') return value;
    const copy = {};
    for (const key in value) {
      if(!Object.hasOwn(value,key))continue;
      const v=value[key];
      const next = key === 'position'
        ? Object.freeze({start: freezePoint(point(v.start)), end: freezePoint(point(v.end))})
        : translate(v, point);
      // Assignment to __proto__ must retain an own data property, as fromEntries did.
      if (key === '__proto__') Object.defineProperty(copy, key, {value: next, enumerable: true});
      else copy[key] = next;
    }
    return Object.freeze(copy);
  }
  function local(source, previous, hint) {
    if (!previous || source.length < 8192) return null;
    const [before, tree] = previous;
    let from = 0, to = before.length, end = source.length;
    // A planner already owns the exact source splice. Check its entire result,
    // not a proof flag; malformed/stale hints use the original diff path.
    if(hint?.before===before&&Number.isSafeInteger(hint.from)&&Number.isSafeInteger(hint.to)
      &&hint.from>=0&&hint.to>=hint.from&&hint.to<=before.length&&typeof hint.insert==='string'
      &&before.slice(0,hint.from)+hint.insert+before.slice(hint.to)===source){
      from=hint.from;to=hint.to;end=from+hint.insert.length;
    }else{
      while (from < to && from < end && before[from] === source[from]) from++;
      while (to > from && end > from && before[to - 1] === source[end - 1]) { to--; end--; }
    }
    const index = tree.children.findIndex(node => node.position.start.offset <= from && node.position.end.offset >= to);
    if (index < 0) return null;
    const node = tree.children[index], start = node.position.start.offset, stop = node.position.end.offset;
    const raw = before.slice(start, stop), delta = source.length - before.length;
    const container=['list','blockquote'].includes(node.type);
    if (!isolated(node, raw, before)||(container&&!ownsInlineChange(node,from,to))
        ||/[\r\n]/.test(before.slice(from,to)+source.slice(from,end))) return null;
    // Keep outer blank boundaries and all physical prefixes. References and
    // definitions cannot be introduced: unresolved bracket text, reference nodes,
    // HTML/code containers and changed block structure use the full parser.
    if (index ? !blankGap(before.slice(tree.children[index - 1].position.end.offset, start)) : start !== 0) return null;
    if (index + 1 < tree.children.length
      ? !blankGap(before.slice(stop, tree.children[index + 1].position.start.offset))
      : !/^[\r\n]*$/.test(before.slice(stop))) return null;
    const nextRaw = source.slice(start, stop + delta);
    if (!nextRaw) return null;
    const oldMargin=raw.match(/[ \t]*$/)[0],newMargin=nextRaw.match(/[ \t]*$/)[0];
    if(oldMargin!==newMargin&&!literalMargin(node,raw,nextRaw,before,source,from,to,end,oldMargin,newMargin))return null;
    const breaks=text=>text.match(/\r\n|\n|\r/g)||[];
    if(JSON.stringify(breaks(raw))!==JSON.stringify(breaks(nextRaw)))return null;
    const editedLine=node.position.start.line+breaks(raw.slice(0,from-start)).length;
    const original=parseFull(raw);
    const point=p=>({...p,offset:p.offset+start,line:p.line+node.position.start.line-1});
    // List spread/lazy context can depend on text outside the owned range.
    // Require the old local parse to reproduce the original global subtree.
    if(original.children.length!==1||JSON.stringify(translate(original.children[0],point))!==JSON.stringify(node))return null;
    const fragment = parseFull(nextRaw);
    if (fragment.children.length !== 1 || fragment.children[0].type !== node.type
        ||!isolated(fragment.children[0],nextRaw,nextRaw)
        ||fragment.children[0].position.end.offset!==nextRaw.length
        ||JSON.stringify(shape(fragment.children[0]))!==JSON.stringify(shape(node))) return null;
    const replacement = translate(fragment.children[0], p => ({...p,
      offset: p.offset + start, line: p.line + node.position.start.line - 1}));
    const shift = p => ({...p, offset: p.offset + delta,
      column: p.column + (p.line === editedLine ? delta : 0)});
    // Every relocated object is frozen during construction; unchanged prefix
    // nodes already belong to the immutable cached tree. Avoid a second complete
    // freezing walk over the new suffix while retaining the cold-tree freeze below.
    return Object.freeze({...tree, children: Object.freeze([...tree.children.slice(0, index), replacement,
      ...tree.children.slice(index + 1).map(child => translate(child, shift))]),
      position: Object.freeze({start: tree.position.start, end: freezePoint(shift(tree.position.end))})});
  }
  return (source,hint) => {
    if (cached.has(source)) {
      const tree = cached.get(source); cached.delete(source); cached.set(source, tree); return tree;
    }
    let reused;
    try { reused=local(source,[...cached].at(-1),hint); } catch { /* Uncertain fragment/context: use the complete parser. */ }
    const tree = freezeGraph(reused || parseFull(source));
    cached.set(source, tree); if (cached.size > 2) cached.delete(cached.keys().next().value);
    return tree;
  };
}
