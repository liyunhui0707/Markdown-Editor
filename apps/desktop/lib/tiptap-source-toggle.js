'use strict';

/* tiptap-source-toggle — Source <-> WYSIWYG state machine for the tiptap engine.

   Swaps the Write surface between the rich (ProseMirror) view and an editable
   raw-markdown <textarea>, both backed by the same note.body. Kept in a pure,
   DOM-injectable module (deps passed in) so the state contract is headlessly
   testable without a real Tiptap editor.

   createSourceToggle({ textarea, richDom, getRichMarkdown, applyMarkdown, onChange, onModeChange })
     textarea        : the source <textarea> (value + style.display + focus()).
     richDom         : the rich editor DOM element (style.display).
     getRichMarkdown : () => string — serialize the rich doc to full markdown (incl. frontmatter).
     applyMarkdown   : (md) => void — parse markdown into the rich editor (splits frontmatter).
     onChange        : (text) => void — dirty-state hook for source-mode typing.
     onModeChange    : (on) => void — fired on EVERY mode change; the host syncs its toggle button here.

   Returns { isSourceMode, getText, setSourceMode, resetToRich, handleInput }. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TiptapSourceToggle = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function createSourceToggle(deps) {
    const d = deps || {};
    const textarea = d.textarea;
    const richDom = d.richDom;
    const getRichMarkdown = (typeof d.getRichMarkdown === 'function') ? d.getRichMarkdown : function () { return ''; };
    const applyMarkdown = (typeof d.applyMarkdown === 'function') ? d.applyMarkdown : function () {};
    const onChange = (typeof d.onChange === 'function') ? d.onChange : null;
    const onModeChange = (typeof d.onModeChange === 'function') ? d.onModeChange : null;

    let sourceMode = false;

    function show(el) { if (el && el.style) el.style.display = ''; }
    function hide(el) { if (el && el.style) el.style.display = 'none'; }

    function isSourceMode() { return sourceMode; }

    function getText() {
      return sourceMode ? (textarea ? textarea.value : '') : getRichMarkdown();
    }

    function enter() {
      if (sourceMode) return;
      if (textarea) textarea.value = getRichMarkdown();
      hide(richDom);
      show(textarea);
      sourceMode = true;
      if (textarea && typeof textarea.focus === 'function') textarea.focus();
      if (onModeChange) onModeChange(true);
    }

    function exit() {
      if (!sourceMode) return;
      const md = textarea ? textarea.value : '';
      sourceMode = false;
      hide(textarea);
      show(richDom);
      applyMarkdown(md);
      if (onModeChange) onModeChange(false);
    }

    function setSourceMode(on) {
      if (on) enter(); else exit();
    }

    // Force the rich surface WITHOUT applying the textarea — used by programmatic
    // setText (note load/switch) so a stale outgoing-note source value is never
    // applied to the incoming note (and onChange is not fired).
    function resetToRich() {
      const wasSource = sourceMode;
      sourceMode = false;
      hide(textarea);
      show(richDom);
      if (wasSource && onModeChange) onModeChange(false);
    }

    function handleInput() {
      if (onChange) onChange(getText());
    }

    // Sync the rich (ProseMirror) document with the current source textarea WHILE
    // staying in source mode. Called from the engine's exitWriteMode (the host's
    // flush hook before save/switch/preview), so rich-model serialization paths
    // never observe stale content. Does NOT change mode or fire onChange.
    function commitSource() {
      if (sourceMode) applyMarkdown(textarea ? textarea.value : '');
    }

    return {
      isSourceMode: isSourceMode,
      getText: getText,
      setSourceMode: setSourceMode,
      resetToRich: resetToRich,
      commitSource: commitSource,
      handleInput: handleInput,
    };
  }

  return { createSourceToggle: createSourceToggle };
});
