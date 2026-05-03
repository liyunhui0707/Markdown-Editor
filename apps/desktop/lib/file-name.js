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

  // Derive the new relativePath when an existing vault note is renamed:
  // keeps the same parent directory and replaces just the basename with the
  // sanitized title. Cross-platform separator handling so the helper works
  // for both POSIX and Windows-style stored relativePaths.
  function deriveRenameRelativePath(oldRelativePath, title) {
    const newBase = deriveDraftRelativePath(title);
    if (!oldRelativePath) return newBase;
    const s = String(oldRelativePath);
    const lastSlash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    if (lastSlash < 0) return newBase;
    return s.slice(0, lastSlash + 1) + newBase;
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
  // and decides whether the operation is:
  //   - vault save-in-place: the user did NOT change the title from its
  //     loaded value, OR the new title's derived path equals the current one
  //     (case-insensitive, e.g. case-only retitling on case-insensitive FS);
  //   - vault rename: the user changed the title and the derived path
  //     differs case-insensitively from the current relativePath;
  //   - draft new file: a brand-new note that has no relativePath yet.
  //
  // For the draft path and the rename target, the disk-side write uses the
  // 'wx' flag so the kernel itself refuses to overwrite an existing file.
  // The fileExistsSync pre-check below is only fast feedback — it produces
  // a clearer error message than EEXIST. Safety is enforced at write time.
  function checkSaveCollision({ vaultPath, note, fileExistsSync, path }) {
    if (!note) {
      return { ok: false, error: 'No note provided.' };
    }

    const safeTitle =
      note.title && String(note.title).trim().length > 0
        ? String(note.title).trim()
        : 'Untitled note';

    // Vault-backed note: decide save-in-place vs rename.
    if (note.source === 'vault' && note.relativePath) {
      // Defensive default: if the renderer omitted loadedTitle, treat the
      // title as unchanged. Never silently rename based on missing input.
      const loadedTitle = note.loadedTitle != null ? note.loadedTitle : note.title;
      const titleChanged = note.title !== loadedTitle;

      if (!titleChanged) {
        return { ok: true, relativePath: note.relativePath };
      }

      const newRelativePath = deriveRenameRelativePath(note.relativePath, safeTitle);
      if (newRelativePath.toLowerCase() === String(note.relativePath).toLowerCase()) {
        // Case-only retitle on case-insensitive FS: same file. The on-file
        // `# Title` line will reflect the new casing on the next write.
        return { ok: true, relativePath: note.relativePath };
      }

      const newFullPath = path.join(vaultPath, newRelativePath);
      if (typeof fileExistsSync === 'function' && fileExistsSync(newFullPath)) {
        return {
          ok: false,
          conflict: true,
          relativePath: newRelativePath,
          error: `A note named "${newRelativePath}" already exists in this vault. Rename your note to save without overwriting.`,
        };
      }

      return {
        ok: true,
        relativePath: newRelativePath,
        renamed: true,
        oldRelativePath: note.relativePath,
      };
    }

    // Draft / new-file branch.
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

  // Single entry-point for the main-process save IPC handler. Runs the
  // collision/rename decision, then performs the disk-side write with
  // no-overwrite semantics (`flag: 'wx'`, which the kernel implements as
  // O_CREAT | O_EXCL — atomic). For renames, the new path is created with
  // 'wx' BEFORE the old path is unlinked, so a target that appears between
  // the renderer's pre-check and the write is still preserved untouched.
  // Vault save-in-place uses a plain write (overwriting our own file is the
  // legitimate update flow).
  function performSaveNote({ vaultPath, note, content, fs, path }) {
    const collision = checkSaveCollision({
      vaultPath,
      note,
      fileExistsSync: fs.existsSync,
      path,
    });

    if (!collision.ok) {
      return collision;
    }

    const relativePath = collision.relativePath;
    const fullPath = path.join(vaultPath, relativePath);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Rename branch: atomically create the new file with 'wx', then unlink
    // the old. If 'wx' fails with EEXIST, neither path is touched.
    if (collision.renamed && collision.oldRelativePath) {
      const oldFullPath = path.join(vaultPath, collision.oldRelativePath);
      try {
        fs.writeFileSync(fullPath, content, { flag: 'wx' });
      } catch (err) {
        if (err && err.code === 'EEXIST') {
          return {
            ok: false,
            conflict: true,
            relativePath,
            error: `A note named "${relativePath}" already exists in this vault. Rename your note to save without overwriting.`,
          };
        }
        throw err;
      }

      // Only after the new file exists with the new content do we remove the
      // old file. If unlink fails the new content is safe at the new path
      // and the old file remains intact — no data loss, no overwrite.
      try {
        fs.unlinkSync(oldFullPath);
      } catch (err) {
        return {
          ok: false,
          error: `Saved to "${relativePath}" but could not remove the old file "${collision.oldRelativePath}": ${err && err.message ? err.message : err}. Both files exist; remove one manually.`,
        };
      }

      return {
        ok: true,
        path: fullPath,
        fileName: path.basename(relativePath),
        relativePath,
        renamed: true,
        oldRelativePath: collision.oldRelativePath,
      };
    }

    // Vault save-in-place: overwriting our own loaded file.
    if (note && note.source === 'vault' && note.relativePath) {
      fs.writeFileSync(fullPath, content, 'utf8');
      return {
        ok: true,
        path: fullPath,
        fileName: path.basename(relativePath),
        relativePath,
      };
    }

    // Draft / new file: refuse to overwrite if the path is taken.
    try {
      fs.writeFileSync(fullPath, content, { flag: 'wx' });
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        return {
          ok: false,
          conflict: true,
          relativePath,
          error: `A note named "${relativePath}" already exists in this vault. Rename your note to save without overwriting.`,
        };
      }
      throw err;
    }

    return {
      ok: true,
      path: fullPath,
      fileName: path.basename(relativePath),
      relativePath,
    };
  }

  return {
    sanitizeFileName,
    deriveDraftRelativePath,
    deriveRenameRelativePath,
    deriveNoteRelativePath,
    findRelativePathConflict,
    checkSaveCollision,
    performSaveNote,
    UNTITLED,
  };
});
