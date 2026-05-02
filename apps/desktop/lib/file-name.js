'use strict';

/* Filename derivation + duplicate-name guard.

   Two layers consume this module:

   - Renderer: pre-checks that a save will not silently overwrite another
     in-memory note (vault file or unsaved draft). Loaded via
       <script src="./lib/file-name.js"></script>
     and exposed on the global as `FileName`.

   - Main process: runs an authoritative existence check against the real
     filesystem before writing, so a draft whose derived path already exists
     on disk cannot silently overwrite the existing file. Loaded via
       const FileName = require('./lib/file-name');

   Both layers MUST agree on the derivation rule, otherwise the renderer's
   advisory check and the main process's hard guard would diverge. The pure
   functions below are dependency-injected (filesystem, path) so they can be
   unit-tested without electron and without touching the disk. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FileName = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const UNTITLED = 'untitled-note';

  // Strip filesystem-illegal chars, trim, collapse internal whitespace runs
  // to a single hyphen, lowercase. The lowercase step is intentional: it
  // matches the case-insensitive reality of macOS APFS / Windows NTFS, so
  // collision detection here behaves the same on every developer machine.
  function sanitizeFileName(name) {
    if (name == null) return '';
    return String(name)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase();
  }

  // Derive the relativePath a draft would occupy on disk. Empty / illegal-only
  // titles fall back to 'untitled-note.md'.
  function deriveDraftRelativePath(title) {
    const base = sanitizeFileName(title) || UNTITLED;
    return `${base}.md`;
  }

  // Return the relativePath a note currently occupies (vault) or would
  // occupy (draft). Used by the renderer to compare every note in `notes`
  // against a candidate path during the pre-save check.
  function deriveNoteRelativePath(note) {
    if (!note) return '';
    if (note.source === 'vault' && note.relativePath) {
      return note.relativePath;
    }
    return deriveDraftRelativePath(note.title);
  }

  // Renderer-side pre-check: scan the in-memory `notes` array for any other
  // note whose relativePath matches the candidate (case-insensitive). The
  // saver itself is excluded via `excludeId`. Returns the conflicting note
  // or null.
  function findRelativePathConflict({ notes, candidateRelativePath, excludeId }) {
    if (!candidateRelativePath) return null;
    const target = String(candidateRelativePath).toLowerCase();
    const list = Array.isArray(notes) ? notes : [];
    for (const note of list) {
      if (!note) continue;
      if (excludeId && note.id === excludeId) continue;
      const otherPath = deriveNoteRelativePath(note);
      if (otherPath && otherPath.toLowerCase() === target) {
        return note;
      }
    }
    return null;
  }

  // Main-process authoritative guard. Determines the relativePath to write
  // and refuses to overwrite an existing file when the path was newly
  // derived (i.e. the note is a draft). Vault notes with an existing
  // relativePath pass through unchanged — re-saving over your own loaded
  // file is the legitimate update flow.
  function checkSaveCollision({ vaultPath, note, fileExistsSync, path }) {
    if (!note) {
      return { ok: false, error: 'No note provided.' };
    }

    if (note.source === 'vault' && note.relativePath) {
      return { ok: true, relativePath: note.relativePath };
    }

    const safeTitle =
      note.title && String(note.title).trim().length > 0
        ? String(note.title).trim()
        : 'Untitled note';
    const relativePath = deriveDraftRelativePath(safeTitle);
    const fullPath = path.join(vaultPath, relativePath);

    if (typeof fileExistsSync === 'function' && fileExistsSync(fullPath)) {
      return {
        ok: false,
        relativePath,
        conflict: true,
        error: `A note named "${relativePath}" already exists in this vault. Rename your note to save without overwriting.`,
      };
    }

    return { ok: true, relativePath };
  }

  return {
    sanitizeFileName,
    deriveDraftRelativePath,
    deriveNoteRelativePath,
    findRelativePathConflict,
    checkSaveCollision,
    UNTITLED,
  };
});
