/* Toast UI Editor options — extracted as a testable pure module.
   Works in Node.js (require) for tests and in the browser (<script src>) as window.makeEditorConfig.
   Pattern matches lib/LiveEditor.js UMD wrapper. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./toast-image-renderer.js'));
  } else {
    root.makeEditorConfig = factory(root.ToastImageRenderer);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ToastImageRenderer) {

  function makeEditorConfig(el) {
    var config = {
      el,
      height: '100%',
      initialEditType: 'markdown',
      previewStyle: 'tab',
      hideModeSwitch: true,
      usageStatistics: false,
      toolbarItems: [
        ['heading', 'bold', 'italic'],
        ['ul', 'ol'],
        ['link'],
      ],
      initialValue: '',
    };
    // Gate Preview-pane image rendering through the same allowlist as the tiptap
    // engine: unsafe + un-resolvable vault-relative URLs render an alt-text
    // placeholder instead of an <img>, so the Preview never fetches them.
    if (ToastImageRenderer && typeof ToastImageRenderer.gatedImage === 'function') {
      config.customHTMLRenderer = { image: ToastImageRenderer.gatedImage };
    }
    return config;
  }

  return makeEditorConfig;
});
