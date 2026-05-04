'use strict';

/* doc-stats — pure helpers for the status-bar readouts.

   All functions are total: '', null, undefined are valid inputs that
   produce a 0 / "0" answer. No DOM, no editor coupling. The host calls
   these on every doc change to refresh the bottom-bar readouts.

   Word-count rule (per Stage 5.2 spec):
     - Each CJK ideograph (Unicode Script=Han) counts as one word.
     - Latin / numeric tokens (sequences of letters or digits, with
       in-token apostrophe / underscore / hyphen allowed) count as one
       word each.
     - Mixed text sums the two: "hello 世界" → 1 + 2 = 3.

   Char-count rule:
     - Counts Unicode code points via Array.from(text), so emoji and
       astral-plane characters count as 1 each (not as 2 UTF-16 units).

   Line-count rule:
     - Empty doc → 0.
     - Otherwise text.split('\n').length, which matches CM6's
       doc.lines for LF-normalized input. A trailing '\n' yields an
       extra empty trailing line, by design.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DocStats = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Each Han ideograph is one word.
  const CJK_REGEX = /\p{Script=Han}/gu;

  // A latin/numeric word: starts with a letter or digit, may contain
  // apostrophe/underscore/hyphen in the middle. \p{L}\p{N} is Unicode-
  // aware so accented characters (café) and non-Latin letters still
  // match correctly.
  const WORD_REGEX = /[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu;

  function countWords(text) {
    if (text == null) return 0;
    const s = String(text);
    if (s.trim() === '') return 0;
    const cjk = s.match(CJK_REGEX);
    const cjkCount = cjk ? cjk.length : 0;
    // Strip CJK so they don't double-count via \p{L}, then tokenize.
    const stripped = s.replace(CJK_REGEX, ' ');
    const latin = stripped.match(WORD_REGEX);
    const latinCount = latin ? latin.length : 0;
    return cjkCount + latinCount;
  }

  function countChars(text) {
    if (text == null) return 0;
    return Array.from(String(text)).length;
  }

  function countLines(text) {
    if (text == null) return 0;
    const s = String(text);
    if (s === '') return 0;
    return s.split('\n').length;
  }

  function formatNumber(n) {
    if (n == null) return '0';
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    return num.toLocaleString('en-US');
  }

  return {
    countWords: countWords,
    countChars: countChars,
    countLines: countLines,
    formatNumber: formatNumber,
  };
});
