'use strict';

/* note-row — pure helpers for the note-list row redesign.

   Reads existing note model fields only (no new fields, no mutation).
   Both helpers are total: null / undefined / missing fields produce a
   safe "nothing" answer.

   computeNoteBadge(note, isDirty)
     Returns the small type badge to render at the top-right of a row.
     - aiImported true        → { kind: 'ai',    label: 'AI' }   (precedence)
     - source === 'draft'     → { kind: 'draft', label: 'Draft' }
     - vault note + isDirty   → { kind: 'draft', label: 'Draft' } (Stage 6.1)
     - vault notes / unknown  → null  (the majority case; no badge)
     `isDirty` is computed by the renderer via lib/dirty-state. Passing a
     boolean keeps this helper pure (no cross-module dependency); when
     omitted, the helper preserves pre-Stage-6.1 behavior.

   computeNoteTags(note, max = 3)
     Returns { visible, overflow } where `visible` is the first `max`
     tag strings (in original order) and `overflow` is how many were
     hidden. Non-array `tags` is treated as no tags (defensive).
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NoteRow = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function computeNoteBadge(note, isDirty) {
    if (note == null) return null;
    if (note.aiImported === true) {
      return { kind: 'ai', label: 'AI' };
    }
    if (note.source === 'draft') {
      return { kind: 'draft', label: 'Draft' };
    }
    if (isDirty === true) {
      return { kind: 'draft', label: 'Draft' };
    }
    return null;
  }

  function computeNoteTags(note, max) {
    const cap = typeof max === 'number' && max >= 0 ? max : 3;
    if (note == null) return { visible: [], overflow: 0 };
    const tags = note.frontmatter && note.frontmatter.tags;
    if (!Array.isArray(tags) || tags.length === 0) {
      return { visible: [], overflow: 0 };
    }
    const visible = tags.slice(0, cap);
    const overflow = Math.max(0, tags.length - visible.length);
    return { visible: visible, overflow: overflow };
  }

  return {
    computeNoteBadge: computeNoteBadge,
    computeNoteTags: computeNoteTags,
  };
});
