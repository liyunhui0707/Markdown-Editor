import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

// Deliberately restricted projection; NOT a serializer. Offsets are UTF-16.
const parser = unified().use(remarkParse).use(remarkGfm);
const unsafe = () => ({ ok: false, code: 'unsafe-source-range' });
const validText = s => typeof s === 'string' && !/[\0\r\n]/.test(s)
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
const splits = (s, n) => n > 0 && n < s.length && /[\uD800-\uDBFF]/.test(s[n - 1]) && /[\uDC00-\uDFFF]/.test(s[n]);

export function projectSource(source) {
  if (typeof source !== 'string' || source.length > 131072) throw Error('Unsupported source');
  const tree = parser.parse(source), content = [], spans = [];
  const fm = /^---(?:\r\n|\n|\r)/.test(source)
    ? source.match(/^---(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---(?=\r\n|\n|\r|$)/)?.[0].length || source.length : 0;
  let position = 0;
  function opaque(text) {
    if (!text) return;
    content.push({ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text }] });
    position += text.length + 2;
  }
  if (fm) opaque(source.slice(0, fm));
  for (const node of tree.children) {
    const start = node.position.start.offset, end = node.position.end.offset;
    if (start < fm) { if (end > fm) opaque(source.slice(fm, end)); continue; }
    const raw = source.slice(start, end), parts = [];
    let supported = ['paragraph', 'heading'].includes(node.type) && node.position.start.line === node.position.end.line
      && !/^(?:[:!]| {4}|\t)/.test(raw) && !/[<>{}\[\]\\`$|]/.test(raw);
    if (node.type === 'heading' && !/^#{1,6}[ \t]+/.test(raw)) supported = false;
    for (const child of node.children || []) {
      const bold = child.type === 'strong';
      const leaf = bold && child.children?.length === 1 ? child.children[0] : child;
      const a = leaf.position?.start.offset, b = leaf.position?.end.offset;
      if (leaf.type !== 'text' || !leaf.value || !validText(leaf.value) || source.slice(a, b) !== leaf.value
          || (bold && !['**', '__'].includes(source.slice(child.position.start.offset, a)))) { supported = false; break; }
      parts.push({ text: leaf.value, sourceFrom: a, sourceTo: b, bold });
    }
    if (!supported || !parts.length) { opaque(raw); continue; }
    const blockIndex = content.length;
    const block = { type: node.type, ...(node.type === 'heading' ? { attrs: { level: node.depth } } : {}), content: [] };
    let offset = 0;
    for (const [childIndex, part] of parts.entries()) {
      spans.push({ ...part, from: position + 1 + offset, to: position + 1 + offset + part.text.length, blockIndex, childIndex });
      block.content.push({ type: 'text', text: part.text, ...(part.bold ? { marks: [{ type: 'bold' }] } : {}) });
      offset += part.text.length;
    }
    content.push(block); position += offset + 2;
  }
  return { doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, spans };
}

export function mapTextEdit(source, change, leaf = null) {
  if (!change || Object.getPrototypeOf(change) !== Object.prototype
      || Object.keys(change).some(k => !['from', 'to', 'insert'].includes(k))) return unsafe();
  const { from, to, insert } = change;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to || !validText(insert) || insert.length > 4096) return unsafe();
  const projection = projectSource(source);
  // Only trusted history supplies this identity. IPC edit payloads cannot.
  if (leaf !== null && (!leaf || Object.getPrototypeOf(leaf) !== Object.prototype
      || Object.keys(leaf).length !== 3 || Object.keys(leaf).some(k => !['blockIndex', 'childIndex', 'bold'].includes(k))
      || !Number.isSafeInteger(leaf.blockIndex) || leaf.blockIndex < 0
      || !Number.isSafeInteger(leaf.childIndex) || leaf.childIndex < 0 || typeof leaf.bold !== 'boolean')) return unsafe();
  const matches = projection.spans.filter(s => from >= s.from && to <= s.to && (!leaf
    || (s.blockIndex === leaf.blockIndex && s.childIndex === leaf.childIndex && s.bold === leaf.bold)));
  if (matches.length !== 1) return unsafe(); // ambiguous insertion between marks
  const span = matches[0], a = from - span.from, b = to - span.from;
  if (splits(span.text, a) || splits(span.text, b)) return unsafe();
  const text = span.text.slice(0, a) + insert + span.text.slice(b);
  if (!text) return unsafe(); // empty spans / structural editing are deferred
  const sourceFrom = span.sourceFrom + a, sourceTo = span.sourceFrom + b;
  const next = source.slice(0, sourceFrom) + insert + source.slice(sourceTo);
  if (next.length > 131072) return unsafe();
  const nextProjection = projectSource(next);
  const expected = structuredClone(projection.doc);
  expected.content[span.blockIndex].content[span.childIndex].text = text;
  if (JSON.stringify(expected) !== JSON.stringify(nextProjection.doc)) return unsafe();
  return { ok: true, source: next, change: { from: sourceFrom, to: sourceTo, insert }, projection: nextProjection,
    leaf: { blockIndex: span.blockIndex, childIndex: span.childIndex, bold: span.bold } };
}
