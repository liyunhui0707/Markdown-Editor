'use strict';
const {MAX_DOCUMENT_BYTES, base64Limit} = require('./document-capacity');
// Trusted one-shot Electron utility entry. No renderer or system Node launch path.
const { createHash } = require('node:crypto');
const { createDocumentFileStore } = require('./document-file-store');
const { copyName } = require('./document-save-policy');
let started = false, complete = false, acknowledgement;
const port = process.parentPort;
if (!port) throw Error('Electron utility parent required');
port.on('message', ({ data }) => {
  if (complete) {
    if (data?.ack === acknowledgement) process.exit(0); // Receipt delivered; all file descriptors already closed.
    else process.exit(1);
    return;
  }
  if (started) { process.exit(1); return; }
  started = true;
  let result, attempted = false;
  try {
    if (!data || typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)
        || !Number.isSafeInteger(data.revision) || data.revision < 0 || !copyName(data.name)
        || typeof data.base64 !== 'string' || data.base64.length > base64Limit(MAX_DOCUMENT_BYTES)) throw Error('invalid-writer-task');
    const bytes = Buffer.from(data.base64, 'base64');
    if (bytes.toString('base64') !== data.base64 || bytes.length > MAX_DOCUMENT_BYTES
        || createHash('sha256').update(bytes).digest('hex') !== data.sha256) throw Error('invalid-writer-task');
    const store = createDocumentFileStore({ persistentCreateTask: data.destination });
    attempted = true;
    result = require('./document-image-export').createWithAttachments({store, name:data.name, bytes, attachments:data.attachments, destination:data.destination});
    if (result.ok) {
      // Recheck the authorized directory identity after creating the selected new file.
      const fs = require('node:fs');
      const named = fs.lstatSync(data.destination.root, { bigint: true });
      if (`${named.dev}:${named.ino}` !== `${data.destination.state.identity.dev}:${data.destination.state.identity.ino}`) {
        result = { ...result, ok: false, state: 'created-unverified', code: 'copy-directory-changed' };
      }
    }
  } catch (cause) {
    result = { ok: false, created: attempted ? null : false,
      state: attempted ? 'create-outcome-unknown' : 'not-created', code: cause.code || 'writer-task-rejected' };
  }
  complete = true; acknowledgement = data?.id;
  port.postMessage({ id: data?.id, revision: data?.revision, sha256: data?.sha256, result });
  // A lost receipt/ack is never a successful child exit.
  setTimeout(() => process.exit(1), 3000);
});
setTimeout(() => { if (!started) process.exit(1); }, 3000).unref();
