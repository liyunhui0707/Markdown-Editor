'use strict';

/* note-row — pure helpers for the note-list row redesign.

   Reads existing note model fields only (no new fields, no mutation).
   All helpers are total: null / undefined / missing fields produce a
   safe "nothing" answer.

   computeNoteBadge(note, isDirty)
     Returns the small TYPE badge at the top-right of a row.
     - aiImported true        → { kind: 'ai',    label: 'AI' }   (precedence)
     - source === 'draft'     → { kind: 'draft', label: 'Draft' }
     - vault note + isDirty   → { kind: 'draft', label: 'Draft' } (Stage 6.1)
     - everything else        → null
     `isDirty` is computed by the renderer via lib/dirty-state. Passing a
     boolean keeps this helper pure (no cross-module dependency); when
     omitted, the helper preserves pre-Stage-6.1 behavior.

   computeNoteDirtyBadge(note, isDirty)         (Stage 6.8)
     Returns the secondary "Draft" badge for AI-imported vault notes
     that the user has modified — rendered ALONGSIDE the AI badge so
     the AI Imports list can distinguish modified vs unmodified rows
     at a glance. For non-AI notes the dirty signal already comes
     through the primary badge, so this helper returns null and the
     renderer doesn't double-render.

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

  // Stage 6.8: secondary dirty badge for AI-imported vault notes only.
  // Returns null for any note that already conveys the dirty state via
  // the primary badge (drafts, plain vault notes), so the renderer
  // doesn't render two "Draft" pills side by side.
  function computeNoteDirtyBadge(note, isDirty) {
    if (note == null) return null;
    if (isDirty !== true) return null;
    if (note.aiImported !== true) return null;
    return { kind: 'draft', label: 'Draft' };
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
    computeNoteDirtyBadge: computeNoteDirtyBadge,
    computeNoteTags: computeNoteTags,
  };
});
