// A two-revision parse cache. Only isolated, single-line inline paragraphs/headings can
// reuse surrounding AST nodes. Projection and edit validation still inspect the
// complete document; uncertain syntax always goes through the complete parser.
export function createSourceParser(parseFull) {
  const cached = new Map();
  const blankGap = text => /^[\r\n]+$/.test(text) && text.replaceAll('\r\n', '\n').length >= 2;
  const inline = node => ['text','inlineCode'].includes(node.type)
    || ['strong','emphasis','delete'].includes(node.type) && node.children?.every(inline);
  const isolated = (node, text) => ['paragraph','heading'].includes(node?.type)
    && node.children?.length > 0 && node.children.every(inline)
    && node.position.start.column === 1 && node.position.start.line === node.position.end.line
    && text.length > 0 && !/[\r\n\[\]<>\\|]/.test(text) && !/[ \t]$/.test(text);
  function translate(value, point) {
    if (Array.isArray(value)) return value.map(v => translate(v, point));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, key === 'position'
      ? {start: point(v.start), end: point(v.end)} : translate(v, point)]));
  }
  function local(source, previous) {
    if (!previous || source.length < 8192) return null;
    const [before, tree] = previous;
    let from = 0, to = before.length, end = source.length;
    while (from < to && from < end && before[from] === source[from]) from++;
    while (to > from && end > from && before[to - 1] === source[end - 1]) { to--; end--; }
    const index = tree.children.findIndex(node => node.position.start.offset <= from && node.position.end.offset >= to);
    if (index < 0) return null;
    const node = tree.children[index], start = node.position.start.offset, stop = node.position.end.offset;
    const raw = before.slice(start, stop), delta = source.length - before.length;
    if (!isolated(node, raw)) return null;
    // Two physical line breaks keep this paragraph separate from lists, fences,
    // setext headings, HTML and lazy continuation. Reference definitions cannot
    // be introduced because brackets/escapes are excluded from both revisions.
    if (index ? !blankGap(before.slice(tree.children[index - 1].position.end.offset, start)) : start !== 0) return null;
    if (index + 1 < tree.children.length
      ? !blankGap(before.slice(stop, tree.children[index + 1].position.start.offset))
      : !/^[\r\n]*$/.test(before.slice(stop))) return null;
    const nextRaw = source.slice(start, stop + delta);
    if (!nextRaw || /[\r\n\[\]<>\\|]/.test(nextRaw)) return null;
    const fragment = parseFull(nextRaw);
    if (fragment.children.length !== 1 || fragment.children[0].type !== node.type || !isolated(fragment.children[0], nextRaw)) return null;
    const replacement = translate(fragment.children[0], p => ({...p,
      offset: p.offset + start, line: p.line + node.position.start.line - 1}));
    const shift = p => ({...p, offset: p.offset + delta,
      column: p.column + (p.line === node.position.end.line ? delta : 0)});
    return {...tree, children: [...tree.children.slice(0, index), replacement,
      ...tree.children.slice(index + 1).map(child => translate(child, shift))],
      position: {start: tree.position.start, end: shift(tree.position.end)}};
  }
  return source => {
    if (cached.has(source)) {
      const tree = cached.get(source); cached.delete(source); cached.set(source, tree); return tree;
    }
    const tree = local(source, [...cached].at(-1)) || parseFull(source), pending = [tree];
    while (pending.length) {
      const value = pending.pop(); if (!value || typeof value !== 'object' || Object.isFrozen(value)) continue;
      for (const child of Object.values(value)) pending.push(child); Object.freeze(value);
    }
    cached.set(source, tree); if (cached.size > 2) cached.delete(cached.keys().next().value);
    return tree;
  };
}
