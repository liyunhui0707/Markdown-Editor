// Stage G.2 — esbuild entry for the vendored Mermaid bundle.
// Initializes Mermaid once at module load with securityLevel: 'strict'
// (rejects HTML in user content + sanitizes SVG output). Exposes
// mermaid on globalThis so cm6-lp-mermaid-widget.js can read it after
// the script tag loads.
const mermaid = require('mermaid').default;

try {
  mermaid.initialize({
    startOnLoad:    false,
    securityLevel:  'strict',
    theme:          'default',
  });
} catch (e) {
  // Initialize failures are non-fatal — the widget's render path is
  // wrapped in try/catch and will render an error placeholder.
}

if (typeof globalThis !== 'undefined') {
  globalThis.mermaid = mermaid;
}
