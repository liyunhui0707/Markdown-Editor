'use strict';
// Shared limits for the complete Document workflow, not general filesystem access.
const MAX_SOURCE_UNITS = 524288; // UTF-16 units, excluding an initial BOM.
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024, MAX_IMAGES = 16;
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024, MAX_ATTACHMENT_PIXELS = 32000000;
const MAX_SESSION_IMAGES = 32, MAX_SESSION_IMAGE_BYTES = 32 * 1024 * 1024, MAX_SESSION_IMAGE_PIXELS = 64000000;
const MAX_RECORD_BYTES = 26 * 1024 * 1024; // Base64 text + aggregate attachments + bounded metadata.
const MAX_HISTORY_UNITS = 4 * 1024 * 1024; // At most 8 MiB of retained UTF-16 inverse/redo text.
const base64Limit = bytes => Math.ceil(bytes / 3) * 4;
module.exports = {MAX_SOURCE_UNITS, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES,
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_PIXELS, MAX_SESSION_IMAGES, MAX_SESSION_IMAGE_BYTES,
  MAX_SESSION_IMAGE_PIXELS, MAX_RECORD_BYTES, MAX_HISTORY_UNITS, base64Limit};
