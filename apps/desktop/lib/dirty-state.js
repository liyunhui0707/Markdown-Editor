'use strict';

/* dirty-state — pure helpers for Stage 6.1.

   isNoteDirty(note)
     Returns true iff the note has unsaved work, derived from the
     existing note model:
       - source === 'vault':
           dirty when body !== loadedBody OR title !== loadedTitle.
           A pristine vault note (just-loaded snapshot equals current
           values) is not dirty. Strict equality means the user can
           type-then-undo back to original and the note re-cleans.
       - source === 'draft':
           dirty when there's any meaningful content — a non-empty
           body, OR a title that is not the bare 'Untitled note'
           placeholder. Whitespace-only inputs do not count.
       - anything else returns false.

   summarizeDirty(notes)
     Tallies dirty notes and reports which categories appear. Used by
     the renderer for sidebar Drafts count and (Stage 6.3) for the
     close-time guard's dialog message.

   Both helpers are total: null / undefined / missing fields are safe.
   No DOM, no editor coupling.
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DirtyState = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // The bare placeholder a fresh blank-template draft starts with. A draft
  // with this title and an empty body has had no meaningful user input.
  const PLACEHOLDER_TITLE = 'Untitled note';

  function isDraftDirty(note) {
    const title = String(note.title == null ? '' : note.title).trim();
    const body  = String(note.body  == null ? '' : note.body ).trim();
    if (body !== '') return true;
    if (title === '' || title === PLACEHOLDER_TITLE) return false;
    return true;
  }

  function isVaultDirty(note) {
    return note.body  !== note.loadedBody
        || note.title !== note.loadedTitle;
  }

  function isNoteDirty(note) {
    if (note == null) return false;
    if (note.source === 'draft') return isDraftDirty(note);
    if (note.source === 'vault') return isVaultDirty(note);
    return false;
  }

  function summarizeDirty(notes) {
    if (!Array.isArray(notes)) {
      return { count: 0, hasDraft: false, hasDirtyVault: false };
    }
    let count = 0;
    let hasDraft = false;
    let hasDirtyVault = false;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (!isNoteDirty(note)) continue;
      count += 1;
      if (note.source === 'draft') hasDraft = true;
      else if (note.source === 'vault') hasDirtyVault = true;
    }
    return { count: count, hasDraft: hasDraft, hasDirtyVault: hasDirtyVault };
  }

  return {
    isNoteDirty: isNoteDirty,
    summarizeDirty: summarizeDirty,
  };
});
