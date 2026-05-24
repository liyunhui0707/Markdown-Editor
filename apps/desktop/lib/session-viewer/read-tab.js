// Stage S3 — Read-tab controller (renderer-side, headless).
// Mounts no DOM; receives the statically-declared readButton + readMount
// from index.html and exposes two methods:
//   setSessionsMode(isSession) — toggles readButton.hidden
//   renderInto(text)           — clears the mount via a removeChild loop
//                                (NEVER innerHTML) and appends a fresh
//                                fragment from the injected renderMarkdown.
//
// CJS-loadable + window.SessionViewer.createReadTabController attachment.

'use strict';

(function () {

function createReadTabController(opts) {
  if (!opts) throw new Error('read-tab: opts is required');
  const readButton = opts.readButton;
  const readMount = opts.readMount;
  const doc = opts.document;
  const renderMarkdown = opts.renderMarkdown;
  if (!readButton) throw new Error('read-tab: readButton is required');
  if (!readMount) throw new Error('read-tab: readMount is required');
  if (!doc) throw new Error('read-tab: document is required');
  if (typeof renderMarkdown !== 'function') {
    throw new Error('read-tab: renderMarkdown function is required');
  }

  function setSessionsMode(isSession) {
    readButton.hidden = !isSession;
  }

  function clearMount() {
    // NEVER innerHTML — round-1 B1 fix. Use a removeChild loop so the
    // SC-S3-5 "no innerHTML access anywhere" invariant holds.
    while (readMount.firstChild) {
      readMount.removeChild(readMount.firstChild);
    }
  }

  function renderInto(text) {
    clearMount();
    const fragment = renderMarkdown(text == null ? '' : String(text), {
      document: doc,
    });
    readMount.appendChild(fragment);
  }

  return { setSessionsMode, renderInto, clearMount };
}

const api = { createReadTabController };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

if (typeof window !== 'undefined') {
  window.SessionViewer = Object.assign(window.SessionViewer || {}, api);
}

})();
