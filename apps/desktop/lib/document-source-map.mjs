import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
import {projectImage} from './document-image-source.mjs';
import {projectTable,mapTableText} from './document-table-source.mjs';
import { projectInlineLeaf, inlineTextNode } from './document-inline-leaf.mjs';
import { mapInlineRange } from './document-inline-source.mjs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { projectSimpleList, listNodeAt } from './document-list-source.mjs';
import {projectStructuredBlock,literalBlockPrefix,mapCodeText} from './document-structured-source.mjs';

export const spanBlock = (projection, span) => span.itemIndex === undefined ? (span.quoteIndex===undefined?projection.doc.content[span.blockIndex]:projection.doc.content[span.blockIndex].content[span.quoteIndex])
  : listNodeAt(projection.doc.content[span.blockIndex],span.itemPath??[span.itemIndex]).content[0];

// Deliberately restricted projection; NOT a serializer. Offsets are UTF-16.
const parser = unified().use(remarkParse).use(remarkGfm);
// Edits repeatedly project the same before/after text. Retain only two immutable
// parse trees; every call still builds fresh mutable projection/validation data.
const parsed = new Map();
function parse(source) {
  if (parsed.has(source)) {
    const tree=parsed.get(source); parsed.delete(source); parsed.set(source,tree); return tree;
  }
  const tree=parser.parse(source), pending=[tree];
  while(pending.length) {
    const value=pending.pop(); if(!value||typeof value!=='object'||Object.isFrozen(value))continue;
    for(const child of Object.values(value))pending.push(child); Object.freeze(value);
  }
  parsed.set(source,tree); if(parsed.size>2)parsed.delete(parsed.keys().next().value);
  return tree;
}
const unsafe = () => ({ ok: false, code: 'unsafe-source-range' });
const validText = s => typeof s === 'string' && !/[\0\r\n]/.test(s)
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
const splits = (s, n) => n > 0 && n < s.length && /[\uD800-\uDBFF]/.test(s[n - 1]) && /[\uDC00-\uDFFF]/.test(s[n]);

export function projectSource(source) {
  if (typeof source !== 'string' || source.length > MAX_SOURCE_UNITS) throw Error('Unsupported source');
  const tree = parse(source), content = [], spans = [], blocks = [];
  const lines = text => { const tokens = text.match(/\r\n|\n|\r/g) || []; return tokens.join('') === text ? tokens : []; };
  const fm = /^---(?:\r\n|\n|\r)/.test(source)
    ? source.match(/^---(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---(?=\r\n|\n|\r|$)/)?.[0].length || source.length : 0;
  let position = 0, previousEnd = fm;
  // Nodes are visited in source order. Scan line boundaries once; two backward
  // searches per paragraph become quadratic when one newline kind is absent.
  const newline = /[\r\n]/g;
  let boundary = newline.exec(source), lineStart = 0;
  function lineBounds(start, end) {
    while (boundary && boundary.index < start) {
      lineStart = boundary.index + 1; boundary = newline.exec(source);
    }
    const from = lineStart;
    while (boundary && boundary.index < end) {
      lineStart = boundary.index + 1; boundary = newline.exec(source);
    }
    return [from, boundary?.index ?? source.length];
  }
  // One cursor slot over existing whitespace, not a CommonMark empty-paragraph node.
  function emptyParagraph(at) {
    spans.push({ text: '', sourceFrom: at, sourceTo: at, bold: false,
      from: position + 1, to: position + 1, blockIndex: content.length, childIndex: 0 });
    blocks.push({from:position,to:position+2,sourceFrom:at,sourceTo:at});
    content.push({ type: 'paragraph', content: [] }); position += 2;
  }
  function opaque(text) {
    if (!text) return;
    blocks.push(null);
    content.push({ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text }] });
    position += text.length + 2;
  }
  if (fm) opaque(source.slice(0, fm));
  for (let node of tree.children) {
    let start = node.position.start.offset, end = node.position.end.offset;
    if (start < fm) { if (end > fm) { opaque(source.slice(fm, end)); previousEnd = end; } continue; }
    // An empty fence prefix can sit before the original file's final newline.
    // Keep that newline outside the cursor span, as for an ordinary paragraph.
    const terminalPrefix = node.type === 'code' && !node.value && end === source.length
      && source.slice(start,end).match(/^(```[A-Za-z0-9_+-]{0,32})(\r\n|\n|\r)$/);
    if (terminalPrefix) {
      end -= terminalPrefix[2].length;
      node = {...node, position:{start:node.position.start,
        end:{...node.position.start,offset:end,column:node.position.start.column+terminalPrefix[1].length}}};
    }
    // A bare shortcut prefix stays visible until Space. This is a projection
    // choice only: source bytes are unchanged, including on read-only opens.
    const pending = source.slice(start, end);
    if (/^(?:#{1,6}|[-+*]|\d{1,9}[.)])$/.test(pending)||literalBlockPrefix(pending)) node = {
      type: 'paragraph', position: node.position,
      children: [{type:'text',value:pending,position:node.position}],
    };
    let structured=projectStructuredBlock(node,source,position,content.length)||projectTable(node,source,position,content.length)||projectImage(node,source,position);
    if(structured){
      const gap=lines(source.slice(previousEnd,start));
      if((!content.length&&!fm&&gap.length>=2)||(content.length&&gap.length>=4)){
        emptyParagraph(!content.length?0:previousEnd+gap[0].length+gap[1].length);
        structured=projectStructuredBlock(node,source,position,content.length)||projectTable(node,source,position,content.length)||projectImage(node,source,position);
      }
      blocks.push(structured.block);content.push(structured.doc);spans.push(...structured.spans);
      position+=structured.size;previousEnd=end;continue;
    }
    const list = projectSimpleList(node, source, position, content.length);
    if (list) {
      const gap = lines(source.slice(previousEnd, start));
      if ((!content.length && gap.length >= 2) || (content.length && gap.length >= 4)) {
        emptyParagraph(!content.length ? 0 : previousEnd + gap[0].length + gap[1].length);
        // The empty cursor slot shifts all ProseMirror positions by two.
        for (const span of list.spans) { span.from += 2; span.to += 2; span.blockIndex++; }
        for (const item of list.items) { item.from += 2; item.to += 2; }
      }
      blocks.push({from:position,to:position+list.size,sourceFrom:start,sourceTo:end,items:list.items});
      content.push(list.doc); spans.push(...list.spans); position += list.size; previousEnd=end; continue;
    }
    const raw = source.slice(start, end), parts = [];
    // Literal brackets and simple inline link labels require exact source leaves.
    // References and nested/normalized labels remain protected.
    let supported = ['paragraph', 'heading'].includes(node.type) && node.position.start.line === node.position.end.line
      && !/^(?:[:!]| {4}|\t)/.test(raw);
    if (node.type === 'heading' && !/^#{1,6}[ \t]+/.test(raw)) supported = false;
    // Plain soft-wrapped paragraphs share one PM text node. Source line breaks
    // render as spaces with NO editable span; each source line keeps its own range.
    const soft = node.type === 'paragraph' && node.position.start.line !== node.position.end.line
      && node.children?.length === 1 && node.children[0].type === 'text' && node.children[0].value === raw
      && !/^(?:[:!]| {4}|\t)/m.test(raw) && !/[<>{}\\`$|]/.test(raw);
    if (soft) {
      let textOffset = 0;
      for (const match of raw.matchAll(/[^\r\n]+/g)) {
        if (!validText(match[0])) break;
        parts.push({ text: match[0], sourceFrom: start + match.index, sourceTo: start + match.index + match[0].length,
          bold: false, textOffset });
        textOffset += match[0].length + 1;
      }
      supported = parts.length >= 2 && parts.map(p => p.text).join(' ') === raw.replace(/\r\n|\n|\r/g, ' ');
    } else if(literalBlockPrefix(pending)){
      parts.push({text:pending,sourceFrom:start,sourceTo:end,bold:false});
    } else for (const child of node.children || []) {
      const part=projectInlineLeaf(child,source);
      if(!part){supported=false;break;}
      parts.push(part);
    }
    if (supported && node.type === 'heading' && !parts.length && /^#{1,6} $/.test(raw)) {
      parts.push({text:'',sourceFrom:end,sourceTo:end,bold:false});
    }
    if (supported && !soft && ['heading','paragraph'].includes(node.type) && node.children?.length) {
      // remark trims margin spaces. Keep them in the editable projection
      // so a word-separating Space can be acknowledged before the next letter.
      // Closing ATX markers are not whitespace and remain untouched source bytes.
      const from = node.children.at(-1).position.end.offset, suffix = source.slice(from, end);
      if (/^ +$/.test(suffix)) {
        const last = parts.at(-1);
        if (!last.bold && !last.italic && !last.code && !last.link) {
          last.text += suffix; last.sourceTo = end;
        } else parts.push({text:suffix,sourceFrom:from,sourceTo:end,bold:false});
      }
    }
    if (supported && node.type === 'paragraph' && parts.length === 1 && !parts[0].bold && !parts[0].italic && !parts[0].code && !parts[0].link) {
      // Keep plain-line margin spaces: remark omits them, but a split must not.
      const [a, b] = lineBounds(start, end);
      if (/^ *$/.test(source.slice(a, parts[0].sourceFrom)) && /^ *$/.test(source.slice(parts[0].sourceTo, b))) {
        start = a; end = b; parts[0] = { ...parts[0], sourceFrom: a, sourceTo: b, text: source.slice(a, b) };
      }
    }
    const gap = lines(source.slice(previousEnd, start));
    if ((!content.length && !fm && gap.length >= 2) || (content.length && gap.length >= 4)) {
      emptyParagraph(!content.length ? 0 : previousEnd + gap[0].length + gap[1].length);
    }
    previousEnd = end;
    if (!supported || !parts.length) { opaque(raw); continue; }
    const blockIndex = content.length;
    const block = { type: node.type, ...(node.type === 'heading' ? { attrs: { level: node.depth } } : {}), content: [] };
    let offset = 0;
    if (soft) {
      block.content.push({ type: 'text', text: parts.map(p => p.text).join(' ') });
      for (const part of parts) spans.push({ ...part, from: position + 1 + part.textOffset,
        to: position + 1 + part.textOffset + part.text.length, blockIndex, childIndex: 0 });
      offset = block.content[0].text.length;
    } else for (const [childIndex, part] of parts.entries()) {
      spans.push({ ...part, from: position + 1 + offset, to: position + 1 + offset + part.text.length, blockIndex, childIndex });
      if (part.text) block.content.push(inlineTextNode(part));
      offset += part.text.length;
    }
    blocks.push({from:position,to:position+offset+2,sourceFrom:start,sourceTo:end});
    content.push(block); position += offset + 2;
  }
  const tail = lines(source.slice(previousEnd));
  if (content.length && tail.length >= 2) emptyParagraph(previousEnd + tail[0].length + tail[1].length);
  if (!content.length) {
    if (source === '' || /^(?:\r\n|\n|\r)$/.test(source)) emptyParagraph(0);
    else content.push({ type: 'paragraph', content: [] }); // Ambiguous blank-only input remains non-editable.
  }
  return { doc: { type: 'doc', content }, spans, blocks };
}

function paragraphEdit(source, projection, change, verify = true, paragraphSeparator = null) {
  const { from, to, insert } = change;
  // Ordinary typing is not a paragraph split/join. Refuse this candidate before
  // filtering spans or cloning the whole document; normal edit validation follows.
  if (!(insert === '\n\n' && from === to) && !(insert === '' && to === from + 2)) return null;
  const plain = span => {
    const block = projection.doc.content[span.blockIndex];
    return block.type === 'paragraph' && span.textOffset === undefined && !span.bold && !span.italic && !span.code && !span.link && (block.content || []).length <= 1;
  };
  const spans = projection.spans.filter(plain), expected = structuredClone(projection.doc);
  // A trusted history separator survives even when a join removes every newline.
  const delimiter = paragraphSeparator ?? (source.match(/\r\n|\n|\r/)?.[0] || '\n').repeat(2);
  let a, b, text, inverse, selection;
  if (insert === '\n\n' && from === to) {
    const span = spans.find(s => from >= s.from && from <= s.to);
    if (!span || !span.text || splits(span.text, from - span.from)) return null;
    const offset = from - span.from, left = span.text.slice(0, offset), right = span.text.slice(offset);
    const paragraph = value => ({ type: 'paragraph', content: value ? [{ type: 'text', text: value }] : [] });
    expected.content.splice(span.blockIndex, 1, paragraph(left), paragraph(right));
    a = b = span.sourceFrom + offset; text = delimiter;
    inverse = { from, to: from + 2, insert: '' }; selection = from + 2;
  } else if (insert === '' && to === from + 2) {
    const left = spans.find(s => s.to === from), right = spans.find(s => s.from === to);
    if (!left || !right || right.blockIndex !== left.blockIndex + 1 || (!left.text && !right.text)
        || source.slice(left.sourceTo, right.sourceFrom) !== delimiter) return null;
    const merged = left.text + right.text;
    expected.content.splice(left.blockIndex, 2, { type: 'paragraph', content: merged ? [{ type: 'text', text: merged }] : [] });
    a = left.sourceTo; b = right.sourceFrom; text = '';
    paragraphSeparator = source.slice(a, b); // Capture the actual pre-operation bytes, never infer them from the joined result.
    inverse = { from, to: from, insert: '\n\n' }; selection = from;
  } else return null;
  paragraphSeparator ??= text;
  const next = source.slice(0, a) + text + source.slice(b);
  if (next.length > MAX_SOURCE_UNITS) return unsafe();
  const nextProjection = projectSource(next);
  if (JSON.stringify(expected) !== JSON.stringify(nextProjection.doc)) return unsafe();
  if (verify) {
    const back = paragraphEdit(next, nextProjection, inverse, false, paragraphSeparator);
    if (!back?.ok || back.source !== source) return unsafe();
  }
  return { ok: true, source: next, change: { from: a, to: b, insert: text }, projection: nextProjection,
    leaf: null, structural: true, inverse, paragraphSeparator, selection: { from: selection, to: selection } };
}

// Atomic replacement across adjacent plain paragraphs (including multiline paste).
// Exact source gaps, full projection equality and a byte-exact inverse are required.
function paragraphReplace(source, projection, change, separator, verify = true) {
  const { from, to, insert } = change, multiline = insert.includes('\n');
  if (!multiline && from === to && separator === null) return null;
  const parts = insert.split('\n\n');
  if (parts.length > 32 || parts.some(p => !validText(p))
      // Only main-owned inverses may reinsert empty selection edges. Renderer
      // multiline input still requires nonempty paragraphs.
      || (multiline && (parts.length < 2 || (separator === null && parts.some(p => !p.trim()))))) return null;
  const spans = projection.spans.filter(s => projection.doc.content[s.blockIndex].type === 'paragraph'
    && s.textOffset === undefined && !s.bold && !s.italic && !s.code && !s.link && (projection.doc.content[s.blockIndex].content || []).length <= 1);
  const left = spans.find(s => from >= s.from && from <= s.to), right = spans.find(s => to >= s.from && to <= s.to);
  if (!left || !right || left.blockIndex > right.blockIndex
      || (!multiline && left === right)
      || splits(left.text, from - left.from) || splits(right.text, to - right.from)) return null;
  const range = spans.filter(s => s.blockIndex >= left.blockIndex && s.blockIndex <= right.blockIndex);
  const delimiter = separator ?? (source.match(/\r\n|\n|\r/)?.[0] || '\n').repeat(2);
  if (range.length > 32 || range.length !== right.blockIndex - left.blockIndex + 1
      || range.some((s, i) => i && source.slice(range[i - 1].sourceTo, s.sourceFrom) !== delimiter)) return null;
  const a = left.sourceFrom + from - left.from, b = right.sourceFrom + to - right.from;
  const removed = source.slice(a, b), oldParts = range.map((s, i) => s.text.slice(i ? 0 : from - s.from, i === range.length - 1 ? to - s.from : undefined));
  const inverseInsert = oldParts.join('\n\n');
  if (removed.length > 4096 || inverseInsert.length > 4096) return unsafe();
  const texts = [...parts]; texts[0] = left.text.slice(0, from - left.from) + texts[0];
  texts[texts.length - 1] += right.text.slice(to - right.from);
  const expected = structuredClone(projection.doc);
  expected.content.splice(left.blockIndex, range.length, ...texts.map(text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })));
  const text = parts.join(delimiter), next = source.slice(0, a) + text + source.slice(b);
  if (text.length > 4096 || next.length > MAX_SOURCE_UNITS) return unsafe();
  const nextProjection = projectSource(next);
  if (JSON.stringify(expected) !== JSON.stringify(nextProjection.doc)) return unsafe();
  const inverse = { from, to: from + insert.length, insert: inverseInsert };
  if (verify) {
    const back = paragraphReplace(next, nextProjection, inverse, delimiter, false);
    if (!back?.ok || back.source !== source) return unsafe();
  }
  return { ok: true, source: next, change: { from: a, to: b, insert: text }, projection: nextProjection,
    structural: true, leaf: null, inverse, paragraphSeparator: delimiter,
    selection: { from: from + insert.length, to: from + insert.length } };
}

export function mapTextEdit(source, change, leaf = null, paragraphSeparator = null) {
  if (!change || Object.getPrototypeOf(change) !== Object.prototype
      || Object.keys(change).some(k => !['from', 'to', 'insert'].includes(k))) return unsafe();
  const { from, to, insert } = change;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to || typeof insert !== 'string' || insert.length > 4096) return unsafe();
  const projection = projectSource(source);
  // Only trusted history supplies this identity. IPC edit payloads cannot.
  if (leaf !== null && (!leaf || Object.getPrototypeOf(leaf) !== Object.prototype
      || Object.keys(leaf).length !== 3 || Object.keys(leaf).some(k => !['blockIndex', 'childIndex', 'bold'].includes(k))
      || !Number.isSafeInteger(leaf.blockIndex) || leaf.blockIndex < 0
      || !Number.isSafeInteger(leaf.childIndex) || leaf.childIndex < 0 || typeof leaf.bold !== 'boolean')) return unsafe();
  // Internal history only; renderer payloads still allow no separator/leaf fields.
  if (paragraphSeparator !== null && (leaf !== null || !['\n\n', '\r\n\r\n', '\r\r'].includes(paragraphSeparator))) return unsafe();
  if(leaf===null&&paragraphSeparator===null){const table=mapTableText(source,projection,change,projectSource);if(table)return table;}
  if (leaf===null&&paragraphSeparator===null){const code=mapCodeText(source,projection,change,projectSource);if(code)return code;}
  if (leaf === null) {
    const paragraph = paragraphEdit(source, projection, change, true, paragraphSeparator);
    if (paragraph) return paragraph;
    const paste = paragraphReplace(source, projection, change, paragraphSeparator);
    if (paste) return paste;
    if (paragraphSeparator !== null) return unsafe();
  }
  if (!validText(insert)) return unsafe();
  const matches = projection.spans.filter(s => from >= s.from && to <= s.to && (!leaf
    || (s.blockIndex === leaf.blockIndex && s.childIndex === leaf.childIndex && s.bold === leaf.bold)));
  if (leaf === null && (matches.length !== 1 || (!insert && from < to && matches[0].from === from && matches[0].to === to))) {
    const inline = mapInlineRange(source, projection, change, projectSource);
    if (inline) return inline;
  }
  if (matches.length !== 1) return unsafe(); // ambiguous insertion between marks
  const span = matches[0], a = from - span.from, b = to - span.from;
  if (splits(span.text, a) || splits(span.text, b)) return unsafe();
  const text = span.text.slice(0, a) + insert + span.text.slice(b);
  if (!text && (span.textOffset !== undefined || !['paragraph','heading'].includes(spanBlock(projection, span).type)
      || span.bold || span.italic || span.code || span.link || spanBlock(projection, span).content.length > 1)) return unsafe();
  const sourceFrom = span.sourceFrom + a, sourceTo = span.sourceFrom + b;
  const next = source.slice(0, sourceFrom) + insert + source.slice(sourceTo);
  if (next.length > MAX_SOURCE_UNITS) return unsafe();
  const nextProjection = projectSource(next);
  const expected = structuredClone(projection.doc);
  if (span.textOffset !== undefined) {
    const node = expected.content[span.blockIndex].content[span.childIndex], at = span.textOffset;
    node.text = node.text.slice(0, at) + text + node.text.slice(at + span.text.length);
  } else if (!span.text || !text) spanBlock({doc:expected}, span).content = text ? [{ type: 'text', text }] : [];
  else spanBlock({doc:expected}, span).content[span.inlineIndex ?? span.childIndex].text = text;
  if (!text && !nextProjection.spans.some(s => s.blockIndex === span.blockIndex && !s.text)) return unsafe();
  if (JSON.stringify(expected) !== JSON.stringify(nextProjection.doc)) return unsafe();
  return { ok: true, source: next, change: { from: sourceFrom, to: sourceTo, insert }, projection: nextProjection,
    leaf: { blockIndex: span.blockIndex, childIndex: span.childIndex, bold: span.bold } };
}
