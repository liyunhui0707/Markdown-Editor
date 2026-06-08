'use strict';

/* Markdown frontmatter split/join — pure, headlessly testable.

   The remark Markdown bridge (markdown-mdast-pm.js) renders the Tiptap WYSIWYG
   body. Leading YAML frontmatter (`---\n…\n---`) must NOT go through that
   pipeline: remark parses `---` as a thematic break and reflows the YAML, which
   corrupts the metadata on round-trip (e.g. `tags:\n  - qa` -> `tags:\n\n- qa`).

   So tiptap-entry.js splits the frontmatter off BEFORE conversion, stores it
   verbatim, and reattaches it on getText(). Frontmatter is therefore preserved
   byte-for-byte and kept out of the editable WYSIWYG body (it is metadata, not
   body content; editing it is a future source-mode concern).

   splitFrontmatter(md)  -> { frontmatter, body }   // frontmatter '' when absent
   joinFrontmatter(fm, body) -> md

   Frontmatter is recognized only as a `---` fence at the VERY start of the
   document, a closing `---` fence on its own line, LF or CRLF, optional trailing
   spaces on fence lines. A lone `---` (no closing fence) is left in the body (it
   is a horizontal rule / setext underline, not frontmatter). */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkdownFrontmatter = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Opening fence at start, lazy content, closing fence on its own line,
  // followed by a newline or end-of-string. Group 1 = the whole frontmatter
  // block (fences included), without the trailing newline after the close.
  const FRONTMATTER_RE = /^(---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*)(\r?\n|$)/;

  function splitFrontmatter(md) {
    const s = (md == null) ? '' : String(md);
    const m = s.match(FRONTMATTER_RE);
    if (!m) return { frontmatter: '', body: s };
    // Drop the blank line(s) between the closing fence and the body so the
    // body starts at real content; joinFrontmatter re-inserts a single blank
    // line. Handles both LF and CRLF.
    const body = s.slice(m[0].length).replace(/^(?:\r?\n)+/, '');
    return { frontmatter: m[1], body: body };
  }

  function joinFrontmatter(frontmatter, body) {
    const fm = (frontmatter == null ? '' : String(frontmatter)).replace(/\s+$/, '');
    const b = (body == null ? '' : String(body)).replace(/^\n+/, '');
    if (!fm) return (body == null ? '' : String(body));
    if (!b) return fm + '\n';
    return fm + '\n\n' + b;
  }

  return {
    splitFrontmatter: splitFrontmatter,
    joinFrontmatter: joinFrontmatter,
  };
});
