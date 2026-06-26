'use strict';

/* tiptap-image-paste — intercept PURE-image paste/drop and externalize to the vault.

   Without this, pasting/dropping an image inlines it as a ~1.5MB base64 data:image
   node (Tiptap Image allowBase64 + ProseMirror's default paste), ballooning the
   editor and the .md file on save. These helpers detect a pure-image transfer
   (image files/items, NO accompanying text) and route each blob through the
   save-image-to-vault IPC, inserting a vault-relative reference instead of base64.

   detectImageTransfer(dataTransfer) -> { pure: boolean, blobs: [{ getBytes, mime }] }
     `pure` is true when the transfer carries raster image file(s) and NO text — the
     screenshot / dropped-image case. The caller CONSUMES the event whenever `pure`
     is true (even if every blob was rejected for size), so an oversized image is
     dropped, NEVER inlined as base64. Files are deduped by object identity; items
     are preferred over .files (a superset) to avoid double-handling the same image.
     `blobs` are the size-accepted images (≤ MAX_BYTES, ≤ MAX_IMAGES).

     A data:image embedded in pasted HTML alongside text (e.g. copying an image FROM
     a web page) is NOT a pure transfer — it has text, so `pure` is false and it falls
     through to ProseMirror. The caller's transformPasted (via isDataUriSrc) then drops
     the data: image node from the parsed slice so no base64 enters; SAVING that
     embedded image to the vault is deferred (would need a full slice/HTML walk).

   handleImageDataTransfer({ blobs, getNoteDir, getNoteId, saveImageToVault, insertImageAt }, { pos })
     For each blob IN ORDER: get bytes -> saveImageToVault(noteDir, bytes, mime);
     on { ok, relPath } -> insertImageAt(relPath, pos) at a deterministic, advancing
     position. NEVER inserts base64; skips on any save/read failure. Because the save
     is async, the note IDENTITY (getNoteId — the note's full path, NOT just its
     directory) is re-checked before each insert; if the user switched notes mid-save
     the batch aborts, so no ref is written into the wrong document. getNoteId falls
     back to getNoteDir when not supplied.

   isDataUriSrc(src) -> boolean
     True when a parsed image node's RESOLVED src is a `data:` URI. The caller wires
     transformPasted to drop such image nodes from a pasted slice — detecting on the
     PARSED slice (entities already decoded by the HTML parser) rather than raw HTML,
     so it is robust against entity-encoded (`data&#58;`) and mixed-case bypasses that
     a regex-on-HTML sanitizer would miss. Preserves the no-base64 invariant for the
     web-copy case; saving the embedded image to the vault is deferred. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TiptapImagePaste = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const RASTER = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 };
  const MAX_BYTES = 20 * 1024 * 1024; // mirror lib/image-write-ipc.js (write-side cap)
  const MAX_IMAGES = 20;              // bound a single paste/drop

  function fileBlob(file) {
    return {
      mime: file.type,
      getBytes: function () {
        return file.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      },
    };
  }

  function hasTextContent(dataTransfer) {
    const types = dataTransfer.types;
    if (types && types.length) {
      for (let i = 0; i < types.length; i++) {
        if (types[i] === 'text/plain' || types[i] === 'text/html') return true;
      }
      return false; // types enumerated, none are text
    }
    const txt = (typeof dataTransfer.getData === 'function') ? (dataTransfer.getData('text/plain') || '') : '';
    return txt.length > 0;
  }

  function detectImageTransfer(dataTransfer) {
    if (!dataTransfer) return { pure: false, blobs: [] };
    const seen = [];   // File-object identity dedup (don't collapse distinct images)
    const files = [];
    function addFile(f) {
      if (!f || !RASTER[f.type] || seen.indexOf(f) !== -1) return;
      seen.push(f);
      files.push(f);
    }
    // Prefer .items (a superset that also exposes getAsFile); fall back to .files
    // only when items yielded no image — avoids double-handling the same image.
    const items = dataTransfer.items;
    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it && it.kind === 'file' && RASTER[it.type] && typeof it.getAsFile === 'function') addFile(it.getAsFile());
      }
    }
    if (!files.length) {
      const fl = dataTransfer.files;
      if (fl && fl.length) for (let i = 0; i < fl.length; i++) addFile(fl[i]);
    }

    const hasImages = files.length > 0;
    const pure = hasImages && !hasTextContent(dataTransfer);

    const blobs = [];
    for (let i = 0; i < files.length && blobs.length < MAX_IMAGES; i++) {
      if (typeof files[i].size === 'number' && files[i].size > MAX_BYTES) continue; // drop oversized (still pure -> event consumed)
      blobs.push(fileBlob(files[i]));
    }
    return { pure: pure, blobs: blobs };
  }

  async function handleImageDataTransfer(deps, baseInfo) {
    const d = deps || {};
    const blobs = d.blobs || [];
    const saveImageToVault = d.saveImageToVault;
    const insertImageAt = d.insertImageAt;
    const getNoteDir = (typeof d.getNoteDir === 'function') ? d.getNoteDir : function () { return ''; };
    // Identity for the note-switch guard = the note's FULL path (getNoteId), so two
    // notes in the SAME directory are distinguished. Falls back to getNoteDir.
    const getNoteId = (typeof d.getNoteId === 'function') ? d.getNoteId : getNoteDir;
    const noteDir = getNoteDir();
    const noteId = getNoteId();
    let pos = (baseInfo && typeof baseInfo.pos === 'number') ? baseInfo.pos : null;
    let handled = 0;
    for (let i = 0; i < blobs.length; i++) {
      let bytes;
      try { bytes = await blobs[i].getBytes(); } catch (_e) { continue; }
      let r;
      try { r = await saveImageToVault(noteDir, bytes, blobs[i].mime); } catch (_e) { continue; }
      if (r && r.ok === true && typeof r.relPath === 'string') {
        // The save is async; if the user switched notes while it was in flight,
        // the captured `pos` points into a DIFFERENT document. Inserting now would
        // write a ./assets ref (relative to the OLD note) into the NEW note. Abort
        // the rest of the batch — the saved file is just an unreferenced dedup blob.
        if (getNoteId() !== noteId) break;
        insertImageAt(r.relPath, pos);
        handled += 1;
        if (typeof pos === 'number') pos += 1; // advance for deterministic ordering
      }
    }
    return handled;
  }

  // transformPasted defense: a data:image embedded in pasted HTML (e.g. copying an
  // image FROM a web page) would otherwise be inlined as base64 by ProseMirror's
  // default paste (Image allowBase64), violating the no-base64 invariant. The caller
  // walks the PARSED paste slice and drops image nodes whose src this predicate flags.
  // Detecting on the parsed src (entities already decoded by the HTML parser) is
  // robust against `data&#58;image` / mixed-case bypasses a raw-HTML regex would miss.
  function isDataUriSrc(src) {
    return typeof src === 'string' && /^data:/i.test(src.trim());
  }

  return {
    detectImageTransfer: detectImageTransfer,
    handleImageDataTransfer: handleImageDataTransfer,
    isDataUriSrc: isDataUriSrc,
  };
});
