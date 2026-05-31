'use strict';

/* Stage F — hybrid-cm6-lp engine: math syntax detector.

   Pure JS scanner that finds candidate math regions in a document
   string. `$` is not a CommonMark/GFM syntax character, so Lezer's
   parser does not emit Math nodes. This module fills the gap with a
   regex-based scanner that respects Pandoc-style rules:

     - Inline math `$x$`:
         opening `$` NOT preceded by `\` (escape);
         opening `$` immediately followed by NON-whitespace;
         closing `$` NOT preceded by whitespace;
         content must NOT contain a newline;
         opening `$` must NOT be the first of a `$$` pair (display);
         closing `$` must NOT be the first of a `$$` pair (display).
     - Display math `$$...$$`:
         opening `$$` NOT preceded by `\`;
         content may span multiple lines;
         closing `$$` matches anywhere after a non-empty content.
         (Empty `$$$$` does NOT match.)
     - Escape: a `$` preceded by an odd number of `\` is escaped
       and does NOT open math.
     - Precedence: display math is scanned FIRST; inline math is
       scanned in the remaining (non-display) ranges.

   Returns an array of `{kind, from, to, source}` where:
     - `kind`   : 'inline' | 'display'
     - `from`   : inclusive start of the math range (the first `$`)
     - `to`     : exclusive end of the math range (just past the last `$`)
     - `source` : the TeX source string BETWEEN the fences (NOT
                  including the `$` or `$$`).

   The caller is responsible for filtering ranges that fall inside
   InlineCode / FencedCode / frontmatter — this module is purely
   text-based.

   Public exports:
     parseMath(docText) -> Array<{kind, from, to, source}>
     _countTrailingBackslashes(text, pos) -> number  (helper, exposed for tests)

   No new dependencies. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Cm6LpMathDetect = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Count consecutive backslashes immediately before `pos`. An odd
  // count means the character at `pos` is escaped.
  function countTrailingBackslashes(text, pos) {
    let n = 0;
    let i = pos - 1;
    while (i >= 0 && text.charAt(i) === '\\') {
      n++;
      i--;
    }
    return n;
  }

  function isEscaped(text, pos) {
    return (countTrailingBackslashes(text, pos) % 2) === 1;
  }

  function isWhitespaceChar(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  // Scan for display math `$$...$$`. Returns array of {from, to, source}.
  function scanDisplay(text) {
    const ranges = [];
    let i = 0;
    while (i < text.length - 1) {
      // Look for "$$" not preceded by an escape.
      if (text.charAt(i) === '$' && text.charAt(i + 1) === '$') {
        if (isEscaped(text, i)) { i++; continue; }
        // Find the closing "$$" starting at i+2.
        let j = i + 2;
        let foundClose = -1;
        while (j < text.length - 1) {
          if (text.charAt(j) === '$' && text.charAt(j + 1) === '$') {
            if (!isEscaped(text, j)) {
              foundClose = j;
              break;
            }
          }
          j++;
        }
        if (foundClose < 0) {
          // No closing fence; abandon this opener.
          i++;
          continue;
        }
        const innerStart = i + 2;
        const innerEnd   = foundClose;
        // Reject empty content "$$$$" (innerStart === innerEnd).
        if (innerEnd <= innerStart) {
          i = foundClose + 2;
          continue;
        }
        ranges.push({
          from:   i,
          to:     foundClose + 2,  // exclusive
          source: text.slice(innerStart, innerEnd),
        });
        i = foundClose + 2;
        continue;
      }
      i++;
    }
    return ranges;
  }

  // Scan for inline math `$...$` in a substring. Returns array of
  // {from, to, source} with positions relative to the substring's
  // start offset.
  function scanInlineInRange(text, startOffset, endOffset) {
    const ranges = [];
    let i = startOffset;
    while (i < endOffset) {
      if (text.charAt(i) !== '$') { i++; continue; }
      if (isEscaped(text, i))     { i++; continue; }
      // Must NOT be the first of a "$$" pair.
      if (i + 1 < endOffset && text.charAt(i + 1) === '$') { i += 2; continue; }
      // Opening `$` must be immediately followed by NON-whitespace.
      const next = i + 1 < endOffset ? text.charAt(i + 1) : '';
      if (next === '' || isWhitespaceChar(next)) { i++; continue; }
      // Find the closing `$` on the same line.
      let j = i + 1;
      let foundClose = -1;
      while (j < endOffset) {
        const ch = text.charAt(j);
        if (ch === '\n') break;  // inline math doesn't cross lines
        if (ch === '$') {
          if (isEscaped(text, j)) { j++; continue; }
          // Must NOT be the first of a "$$" pair.
          if (j + 1 < endOffset && text.charAt(j + 1) === '$') { j++; continue; }
          // Closing `$` must NOT be preceded by whitespace.
          const prev = text.charAt(j - 1);
          if (isWhitespaceChar(prev)) { j++; continue; }
          foundClose = j;
          break;
        }
        j++;
      }
      if (foundClose < 0) { i++; continue; }
      ranges.push({
        from:   i,
        to:     foundClose + 1,  // exclusive
        source: text.slice(i + 1, foundClose),
      });
      i = foundClose + 1;
    }
    return ranges;
  }

  // Top-level entry point. Scans for display math first; then inline
  // math in the gaps. Returns combined sorted-by-from array of
  // {kind, from, to, source}.
  function parseMath(docText) {
    if (typeof docText !== 'string' || docText.length === 0) return [];

    const display = scanDisplay(docText).map(function (r) {
      return { kind: 'display', from: r.from, to: r.to, source: r.source };
    });

    // Carve out the gaps between display ranges and scan inline in each.
    const inline = [];
    let cursor = 0;
    for (let k = 0; k < display.length; k++) {
      const d = display[k];
      if (cursor < d.from) {
        const gapInline = scanInlineInRange(docText, cursor, d.from);
        for (let g = 0; g < gapInline.length; g++) {
          inline.push({
            kind:   'inline',
            from:   gapInline[g].from,
            to:     gapInline[g].to,
            source: gapInline[g].source,
          });
        }
      }
      cursor = d.to;
    }
    if (cursor < docText.length) {
      const tailInline = scanInlineInRange(docText, cursor, docText.length);
      for (let g = 0; g < tailInline.length; g++) {
        inline.push({
          kind:   'inline',
          from:   tailInline[g].from,
          to:     tailInline[g].to,
          source: tailInline[g].source,
        });
      }
    }

    // Combine and sort by from.
    const all = display.concat(inline);
    all.sort(function (a, b) { return a.from - b.from; });
    return all;
  }

  return {
    parseMath:                    parseMath,
    _countTrailingBackslashes:    countTrailingBackslashes,
    _isEscaped:                   isEscaped,
  };
});
