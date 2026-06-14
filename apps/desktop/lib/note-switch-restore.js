'use strict';

/* note-switch-restore — pure decision for renderEditor's note-switch path.

   When the user switches notes, the host either RESTORES the incoming note's
   cached editor state (note-local undo/redo) or RELOADS the note via setText.
   Restoring is only valid when the engine actually supports state restore AND
   the cached snapshot still matches the note's current body.

   Engines that do NOT expose setState (hybrid, tiptap) must always fall back to
   setText. The `tiptap` engine previously advertised a NO-OP setState, so the
   host "restored" via that no-op and skipped setText — leaving the editor
   showing the PREVIOUS note's content (and a Save would write it to the wrong
   file). Centralizing the decision here makes that contract testable and keeps
   "no setState => always setText" explicit.

   shouldRestoreCachedState(hasSetState, cached, noteBody) -> boolean
     hasSetState : typeof liveEditorInstance.setState === 'function'
     cached      : noteEditorStates.get(note.id) | undefined  ({ state, doc })
     noteBody    : note.body (current)

   Total: null / undefined / missing fields are safe. No DOM, no editor coupling.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NoteSwitchRestore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function shouldRestoreCachedState(hasSetState, cached, noteBody) {
    return !!hasSetState && !!cached && cached.doc === noteBody;
  }

  return {
    shouldRestoreCachedState: shouldRestoreCachedState,
  };
});
