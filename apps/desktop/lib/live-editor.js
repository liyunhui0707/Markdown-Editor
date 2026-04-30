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

  /* Alias of parseBlocks exposed under the TDD-plan name. */
  var splitMarkdownIntoBlocks = parseBlocks;

  /* Return the block containing cursorPosition, or null.
     markdownText is required to decide the EOF-without-trailing-newline edge case:
     when the cursor is at text.length and the last character is not a newline,
     the cursor is logically inside the final block. */
  function findActiveBlock(blocks, cursorPosition, markdownText) {
    if (typeof cursorPosition !== 'number') return null;
    if (!markdownText && markdownText !== '') return null;
    if (cursorPosition < 0 || cursorPosition > markdownText.length) return null;
    if (!blocks || blocks.length === 0) return null;

    // EOF without trailing newline and no gap after the last block.
    // Only return the last block when the cursor is exactly at lastBlock.end,
    // so a trailing whitespace gap ("# T\n\n  ") correctly returns null.
    const lastBlock = blocks[blocks.length - 1];
    const lastChar  = markdownText[markdownText.length - 1];
    if (cursorPosition === markdownText.length &&
        lastChar !== '\n' && lastChar !== '\r' &&
        cursorPosition === lastBlock.end) {
      return lastBlock;
    }

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.start <= cursorPosition && cursorPosition < b.end) return b;
    }
    return null;
  }

  /* Build the hybrid render model: a single ordered segments[] that covers
     [0, markdownText.length) exhaustively.
     Block segments: { kind:'block', start, end, raw, type, isActive }
     Gap   segments: { kind:'gap',   start, end, raw }
     No HTML is generated here. All raw values are exact slices of markdownText. */
  function buildHybridRenderModel(markdownText, cursorPosition) {
    if (!markdownText) return { segments: [] };

    var blocks  = parseBlocks(markdownText);
    var active  = findActiveBlock(blocks, cursorPosition, markdownText);
    var segments = [];
    var pos = 0;

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (pos < b.start) {
        segments.push({ kind: 'gap', start: pos, end: b.start,
                        raw: markdownText.slice(pos, b.start) });
      }
      segments.push({ kind: 'block', start: b.start, end: b.end,
                      raw: b.raw, type: b.type, isActive: b === active });
      pos = b.end;
    }

    if (pos < markdownText.length) {
      segments.push({ kind: 'gap', start: pos, end: markdownText.length,
                      raw: markdownText.slice(pos) });
    }

    return { segments: segments };
  }

  return { parseBlocks, replaceBlock, splitMarkdownIntoBlocks,
           findActiveBlock, buildHybridRenderModel };
});
