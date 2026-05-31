// Stage G.1 — esbuild entry for the vendored highlight.js bundle.
// Imports the COMMON-languages bundle (~100KB) which includes JS, TS, Python,
// Rust, Go, Java, C, C++, Bash, JSON, YAML, HTML, CSS, SQL, and ~20 more
// without the rarer-language bloat (~1.5MB full bundle).
// Exposes hljs on globalThis so cm6-lp-code-widget.js can read it after
// the script tag loads.
const hljs = require('highlight.js/lib/common');
if (typeof globalThis !== 'undefined') {
  globalThis.hljs = hljs;
}
