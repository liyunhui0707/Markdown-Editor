'use strict';

/* Stage A — hybrid-cm6-lp Write engine adapter (live preview).

   The lp engine is a fourth Write engine alongside hybrid (legacy
   fallback), cm6 (fallback), and hybrid-cm6 (Stage 17 default). Opt-in
   via ?writeEngine=hybrid-cm6-lp or
   localStorage.markdownVault.writeEngine.

   The lp engine's only behavioral difference from hybrid-cm6 is how
   emphasis markers (`*`, `_`, `**`, `__`) are rendered:
     - Off-active-line: Decoration.replace removes them visually;
       EditorView.atomicRanges makes arrow-key motion step over them.
     - On-active-line: same as hybrid-cm6 (dimmed reveal via existing CSS).

   The lp adapter REUSES the hybrid engine's decoration walker via the
   public export Cm6HybridView.buildHeadingDecorations (cm6-hybrid-view.js
   line 702). It does NOT duplicate the walker. The lp-emphasis plugin
   sits on top and visually overrides the walker's Decoration.mark for
   EmphasisMark ranges (replace wins visually over mark on the same range).

   Adapter contract — same shape as cm6-hybrid-view.js's
   createCm6HybridView (cross-engine-smoke.test.js Stage 16-6):
     view, getText, setText, getState, setState, exitWriteMode, focus, destroy.

   buildState duplication: ~70 lines below mirror cm6-hybrid-view.js:618-682
   intentionally. Extracting a shared buildState would require modifying
   cm6-hybrid-view.js, on the no-touch list. The WAVE 2 parity test pins
   that the lp extension list is hybrid + lp-emphasis. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // The lp adapter looks up Cm6HybridView and Cm6LpInline from
    // globalThis at construction time so the browser path (script-tag
    // ordering) and CJS path (Node tests) share the same lookup logic.
    // cm6-hybrid-view.js's CJS wrapper sets module.exports only — it
    // does NOT set root.Cm6HybridView. Bridge it here so the inner
    // factory finds the module via globalThis uniformly. Same for
    // cm6-lp-inline.js (which does set its own globalThis via the
    // pattern matched on cm6-line-utils.js, but we bridge defensively).
    const hybrid     = require('./cm6-hybrid-view.js');
    const lpEmph     = require('./cm6-lp-inline.js');
    const lpBlock    = require('./cm6-lp-block.js');
    const lpBlockW   = require('./cm6-lp-block-widgets.js');
    if (typeof globalThis !== 'undefined') {
      if (!globalThis.Cm6HybridView)      globalThis.Cm6HybridView      = hybrid;
      if (!globalThis.Cm6LpInline)        globalThis.Cm6LpInline        = lpEmph;
      if (!globalThis.Cm6LpBlock)         globalThis.Cm6LpBlock         = lpBlock;
      if (!globalThis.Cm6LpBlockWidgets)  globalThis.Cm6LpBlockWidgets  = lpBlockW;
    }
    module.exports = factory();
  } else {
    root.Cm6LpView = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Read the hybrid-view export at factory time. The browser path relies
  // on script-tag ordering (lp-view.js is loaded AFTER hybrid-view.js in
  // index.html); the CJS path required hybrid-view above.
  function getHybridViewModule() {
    if (typeof globalThis !== 'undefined' && globalThis.Cm6HybridView) {
      return globalThis.Cm6HybridView;
    }
    return null;
  }

  function getLpInlineModule() {
    if (typeof globalThis !== 'undefined' && globalThis.Cm6LpInline) {
      return globalThis.Cm6LpInline;
    }
    return null;
  }

  function getLpBlockModule() {
    if (typeof globalThis !== 'undefined' && globalThis.Cm6LpBlock) {
      return globalThis.Cm6LpBlock;
    }
    return null;
  }

  function getLpBlockWidgetsModule() {
    if (typeof globalThis !== 'undefined' && globalThis.Cm6LpBlockWidgets) {
      return globalThis.Cm6LpBlockWidgets;
    }
    return null;
  }

  function createCm6LpView(parent, opts) {
    const o          = opts || {};
    const initialDoc = o.initialDoc != null ? String(o.initialDoc) : '';
    const onChange   = typeof o.onChange === 'function' ? o.onChange : null;
    const cm6        = o.cm6;
    // Stage C — optional renderer hooks for vault-relative image resolution.
    // getNoteDir   : () => string|null    — current note's directory, called
    //                                       at decoration build time so a note
    //                                       switch reflects in the next paint.
    // resolveImagePath : (noteDir, relPath) => Promise<{ok,fileUrl}|{ok:false,reason}>
    //                                       — the vaultApi.resolveImagePath
    //                                       IPC client (or a test stub).
    // Both fields are optional. When absent, vault-relative images fall back
    // to the rejected placeholder (the widget can't resolve them).
    const getNoteDir       = typeof o.getNoteDir       === 'function' ? o.getNoteDir       : null;
    const resolveImagePath = typeof o.resolveImagePath === 'function' ? o.resolveImagePath : null;

    if (!cm6 || !cm6.EditorState || !cm6.EditorView) {
      throw new Error('cm6 backend missing (pass opts.cm6 from the bundled namespace)');
    }
    if (!cm6.ViewPlugin || !cm6.Decoration) {
      throw new Error('cm6 lp live-styling missing required primitives (ViewPlugin, Decoration)');
    }

    const hybridModule = getHybridViewModule();
    if (!hybridModule || typeof hybridModule.buildHeadingDecorations !== 'function') {
      throw new Error(
        'Cm6HybridView.buildHeadingDecorations missing — load cm6-hybrid-view.js before cm6-lp-view.js'
      );
    }
    const buildHeadingDecorations = hybridModule.buildHeadingDecorations;

    const lpInlineModule = getLpInlineModule();
    if (!lpInlineModule || typeof lpInlineModule.createLpInlineExtension !== 'function') {
      throw new Error(
        'Cm6LpInline.createLpInlineExtension missing — load cm6-lp-inline.js before cm6-lp-view.js'
      );
    }

    // Stage D — lp-block plugin is optional. When the module is not loaded
    // (legacy browser path without the script tag), the lp engine degrades
    // gracefully: block markers continue to render via the walker's
    // existing Decoration.mark + CSS display:none mechanism — same as
    // hybrid-cm6's behavior. The Stage D atomic-cursor-motion improvement
    // is the only thing skipped.
    const lpBlockModule = getLpBlockModule();

    // The heading walker plugin. Identical shape to cm6-hybrid-view.js:604-616:
    // rebuild on docChanged | viewportChanged; selection changes do NOT rebuild
    // here because hybrid's reveal is CSS-driven (selection-independent
    // decoration set). The lp-emphasis plugin DOES rebuild on selectionSet —
    // it owns the selection-dependent replace-vs-mark decision.
    const headingMarkPlugin = cm6.ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = buildHeadingDecorations(view.state, cm6);
        }
        update(update) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildHeadingDecorations(update.state, cm6);
          }
        }
      },
      { decorations: (v) => v.decorations }
    );

    function buildState(doc) {
      const extensions = [
        cm6.history(),
        cm6.markdown ? cm6.markdown() : null,
        cm6.EditorView.lineWrapping,
        cm6.EditorView.updateListener.of(function (update) {
          if (!update.docChanged) return;
          if (!onChange) return;
          onChange(update.state.doc.toString());
        }),
        headingMarkPlugin,
        Array.isArray(cm6.chrome) ? cm6.chrome : null,
      ].filter(function (e) { return e != null; });

      // Optional hook extensions — same shape as cm6-hybrid-view.js. The lp
      // engine inherits the SAME hook reads as hybrid so behavior parity
      // holds for everything except emphasis-marker rendering.
      const taskToggle =
        (typeof globalThis !== 'undefined') ? globalThis.Cm6TaskToggle : null;
      if (taskToggle && typeof taskToggle.createTaskToggleExtension === 'function') {
        const ext = taskToggle.createTaskToggleExtension(cm6);
        if (ext != null) extensions.push(ext);
      }
      const linkClick =
        (typeof globalThis !== 'undefined') ? globalThis.Cm6LinkClick : null;
      if (linkClick && typeof linkClick.createLinkClickExtension === 'function') {
        const ext = linkClick.createLinkClickExtension(cm6);
        if (ext != null) extensions.push(ext);
      }
      const activeRange =
        (typeof globalThis !== 'undefined') ? globalThis.Cm6ActiveRange : null;
      if (activeRange && typeof activeRange.createActiveRangeExtension === 'function') {
        const ext = activeRange.createActiveRangeExtension(cm6);
        if (ext != null) extensions.push(ext);
      }
      const constructReveal =
        (typeof globalThis !== 'undefined') ? globalThis.Cm6ConstructReveal : null;
      if (constructReveal && typeof constructReveal.createConstructRevealExtension === 'function') {
        const ext = constructReveal.createConstructRevealExtension(cm6);
        if (ext != null) extensions.push(ext);
      }

      // The lp-specific extension: emphasis-marker replace-vs-mark plugin
      // PLUS atomicRanges registration via its provide clause. WAVE 2
      // installs the skeleton (no-op decorations); WAVE 4 fills in the
      // real behavior. The factory returns null if any required cm6
      // surface is missing, in which case the lp engine degrades to
      // hybrid-cm6 behavior with no atomic-range stepping.
      const lpInlineExt = lpInlineModule.createLpInlineExtension(cm6, {
        getNoteDir:       getNoteDir,
        resolveImagePath: resolveImagePath,
      });
      if (lpInlineExt != null) extensions.push(lpInlineExt);

      // Stage D — block-marker plugin. Optional module; sentinel returns
      // null if any cm6 surface is missing, in which case the lp engine
      // degrades to walker-only block-marker rendering.
      if (lpBlockModule && typeof lpBlockModule.createLpBlockExtension === 'function') {
        const lpBlockExt = lpBlockModule.createLpBlockExtension(cm6);
        if (lpBlockExt != null) extensions.push(lpBlockExt);
      }

      // Stage G.3 — block-widget StateField. Owns Stage E table + Stage F
      // display math + Stage G.1/G.2 fenced code (all block:true). CM6
      // rejects block decorations from ViewPlugins, so this MUST be a
      // StateField. Sentinel: returns null if cm6.StateField is missing.
      const lpBlockWidgetsModule = getLpBlockWidgetsModule();
      if (lpBlockWidgetsModule && typeof lpBlockWidgetsModule.createLpBlockWidgetExtension === 'function') {
        const lpBlockWidgetsExt = lpBlockWidgetsModule.createLpBlockWidgetExtension(cm6);
        if (lpBlockWidgetsExt != null) extensions.push(lpBlockWidgetsExt);
      }

      return cm6.EditorState.create({ doc: doc, extensions: extensions });
    }

    const view = new cm6.EditorView({
      state:  buildState(initialDoc),
      parent: parent,
    });

    return {
      view: view,
      getText:       function ()       { return view.state.doc.toString(); },
      setText:       function (text)   { view.setState(buildState(text == null ? '' : String(text))); },
      getState:      function ()       { return view.state; },
      setState:      function (state)  { view.setState(state); },
      exitWriteMode: function ()       { /* no-op: CM6 has no inactive-block mode */ },
      focus:         function ()       { view.focus(); },
      destroy:       function ()       { view.destroy(); },
    };
  }

  return { createCm6LpView };
});
