'use strict';
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { captureCopyDestination } = require('./document-save-policy');
const { createDocumentFileStore } = require('./document-file-store');
const unknown = code => ({ ok: false, state: 'create-outcome-unknown', created: null, code });
// Injected fork is a trusted main-process capability, never supplied by renderer.
function createCopyProcess({ fork, writerPath = path.join(__dirname, 'document-copy-writer.js'), timeoutMs = 12000 }) {
  const active = new Map();
  async function create({ filePath, bytes, revision, isAuthorized }) {
    let target, child;
    const authorized = () => { try { return typeof isAuthorized === 'function' && isAuthorized() === true; } catch { return false; } };
    try {
      if (!Buffer.isBuffer(bytes) || bytes.length > 1048576 || !Number.isSafeInteger(revision)
          || revision < 0 || typeof isAuthorized !== 'function' || !authorized()) throw Object.assign(Error(), { code: 'copy-authorization-expired' });
      target = captureCopyDestination(filePath);
    } catch (cause) {
      return { ok: false, state: cause.code === 'target-exists' ? 'target-exists' : 'not-created', created: false,
        code: cause.code || 'copy-directory-refused' };
    }
    const id = randomUUID(), sha256 = createHash('sha256').update(bytes).digest('hex');
    try {
      target.verify();
      if (!authorized()) throw Error('authorization expired');
      // Do not inherit NODE_OPTIONS, Electron mode switches, credentials or user config.
      const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
      for (const k of ['TMPDIR', 'TMP', 'TEMP']) if (process.env[k]) env[k] = process.env[k];
      child = fork(writerPath, [], { cwd: target.root, env, execArgv: [], stdio: 'pipe', serviceName: 'Markdown exclusive copy' });
      return await new Promise(resolve => {
        let response, messages = 0, invalid = false, settled = false, termination;
        const finish = result => {
          if (settled) return; settled = true; clearTimeout(timer); clearTimeout(termination); active.delete(child);
          resolve({ ...result, filePath, directoryIdentity: target.state.identity });
        };
        const stop = code => {
          invalid = true; if (termination || settled) return;
          try { child.kill(); } catch { /* Outcome remains unknown. */ }
          termination = setTimeout(() => finish(unknown(code)), 1500);
        };
        const timer = setTimeout(() => stop('writer-timeout'), timeoutMs);
        active.set(child, () => stop('writer-cancelled'));
        let output = 0;
        for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
          output += chunk.length; invalid = true; if (output > 4096) stop('writer-output-rejected');
        });
        child.on('error', () => stop('writer-error'));
        child.on('spawn', () => {
          try {
            target.verify();
            if (!authorized()) throw Error('authorization expired');
            child.postMessage({ id, revision, sha256, base64: bytes.toString('base64'), name: target.name,
              destination: { root: target.root, state: target.state } });
          } catch { stop('copy-authorization-expired'); }
        });
        child.on('message', message => {
          ++messages;
          if (messages !== 1 || !message || message.id !== id || message.revision !== revision
              || message.sha256 !== sha256 || typeof message.result?.ok !== 'boolean') { stop('writer-response-rejected'); return; }
          response = message.result;
          try { child.postMessage({ ack: id }); } catch { stop('writer-response-lost'); }
        });
        child.once('exit', code => {
          if (code !== 0 || invalid || messages !== 1 || !response) { finish(unknown('writer-exit-unconfirmed')); return; }
          if (!authorized()) { finish({ ...unknown('copy-authorization-expired'), created: response.created === true ? true : null }); return; }
          if (response.ok) {
            try {
              target.verify();
              if (response.state !== 'created-confirmed' || response.created !== true || response.filePath !== filePath
                  || response.sha256 !== sha256 || response.byteLength !== bytes.length) throw Error('invalid receipt');
              const read = createDocumentFileStore().read(filePath, 1048576);
              if (`${read.identity.dev}:${read.identity.ino}` !== response.fileIdentity || read.identity.mode !== 0o600
                  || read.identity.uid !== target.state.identity.uid || read.identity.gid !== target.state.identity.gid
                  || read.sha256 !== sha256 || !read.bytes.equals(bytes)) throw Error('created file changed');
              target.verify();
            } catch { finish({ ...response, ok: false, state: 'created-unverified', code: 'copy-post-verification-failed' }); return; }
          } else if (!Object.hasOwn({ 'not-created': false, 'target-exists': false, 'created-partial': true, 'created-unverified': true, 'durability-uncertain': true, 'create-outcome-unknown': null }, response.state)
              || response.created !== ({ 'not-created': false, 'target-exists': false, 'created-partial': true, 'created-unverified': true, 'durability-uncertain': true, 'create-outcome-unknown': null })[response.state]) { finish(unknown('writer-response-rejected')); return; }
          finish(response);
        });
      });
    } catch { return { ...unknown('writer-launch-unconfirmed'), filePath }; }
    finally { target.close(); }
  }
  return { create, cancelAll() { for (const cancel of active.values()) cancel(); } };
}
module.exports = { createCopyProcess };
