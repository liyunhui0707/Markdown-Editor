/* Core Markdown block parser.
   Works in both Node.js (for tests) and the browser (plain <script> tag). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LiveEditorCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* Decide what kind of Markdown line this is. */
  function classifyLine(line) {
    if (/^#{1,6}\s/.test(line))             return 'heading';
    if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) return 'list';
    if (/^>\s?/.test(line))                 return 'blockquote';
    if (/^\|/.test(line))                   return 'table';
    if (/^(`{3,}|~{3,})/.test(line))        return 'code_fence';
    if (line.trim() === '')                 return 'blank';
    return 'paragraph';
  }

  /* Split raw Markdown text into an array of blocks.
     Each block has: { start, end, raw, type }
     - start/end are character offsets into the original text
     - raw is the original text for that block
     - type is one of: heading, list, blockquote, table, code_fence, paragraph */
  function parseBlocks(text) {
    if (!text) return [];

    const lines = text.split('\n');
    const blocks = [];
    let i = 0;
    let charOffset = 0;

    while (i < lines.length) {
      const line = lines[i];
      const lineLen = line.length + 1; // +1 for the \n

      // Skip blank lines — they are just separators, not blocks
      if (line.trim() === '') {
        charOffset += lineLen;
        i += 1;
        continue;
      }

      const type = classifyLine(line);

      // Code fences span multiple lines until the closing fence
      if (type === 'code_fence') {
        const blockStart = charOffset;
        let raw = line;
        charOffset += lineLen;
        i += 1;

        while (i < lines.length) {
          const inner = lines[i];
          raw += '\n' + inner;
          charOffset += inner.length + 1;
          i += 1;
          if (/^(`{3,}|~{3,})/.test(inner)) break; // closing fence
        }

        blocks.push({ start: blockStart, end: blockStart + raw.length, raw, type: 'code_fence' });
        continue;
      }

      // Headings are always one line
      if (type === 'heading') {
        const blockStart = charOffset;
        blocks.push({ start: blockStart, end: blockStart + line.length, raw: line, type: 'heading' });
        charOffset += lineLen;
        i += 1;
        continue;
      }

      // Everything else: keep merging consecutive lines of the same type
      const blockStart = charOffset;
      let raw = line;
      charOffset += lineLen;
      i += 1;

      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '') break;
        const nextType = classifyLine(next);
        if (nextType === 'heading' || nextType === 'code_fence') break;
        if (nextType !== type) break;
        raw += '\n' + next;
        charOffset += next.length + 1;
        i += 1;
      }

      blocks.push({ start: blockStart, end: blockStart + raw.length, raw, type });
    }

    return blocks;
  }

  /* Replace one block's text inside the full document string. */
  function replaceBlock(text, block, newRaw) {
    return text.slice(0, block.start) + newRaw + text.slice(block.end);
  }

  return { parseBlocks, replaceBlock };
});
