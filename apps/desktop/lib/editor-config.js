/* Toast UI Editor options — extracted as a testable pure module.
   Works in Node.js (require) for tests and in the browser (<script src>) as window.makeEditorConfig.
   Pattern matches lib/LiveEditor.js UMD wrapper. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.makeEditorConfig = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function makeEditorConfig(el) {
    return {
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
  }

  return makeEditorConfig;
});
