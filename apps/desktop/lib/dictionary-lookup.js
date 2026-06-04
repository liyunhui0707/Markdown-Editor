'use strict';

// Main-process helper for the local Dictionary macOS app integration.
//
// The renderer captures the selection + surrounding paragraph and hands it
// here over IPC. We read the bearer token the Dictionary app writes to its
// Application Support directory and POST to the loopback HTTP server the
// Dictionary app runs (127.0.0.1:49152). The Dictionary app shows the
// translation popup itself on success, so we only return ok/error here for
// status feedback in the renderer.
//
// Networking lives in the main process on purpose: a renderer fetch to
// 127.0.0.1 would be blocked by CORS (the Dictionary server sets no CORS
// headers). The main process has no such restriction.
//
// Dependencies (http, fs, os, path) are injected so the logic is unit-testable
// without real sockets or a real token file.

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 49152;
const SERVER_PATH = '/v1/translate';

function tokenPath(os, path) {
  return path.join(os.homedir(), 'Library', 'Application Support', 'DictionaryApp', 'token');
}

function readToken({ fs, os, path }) {
  try {
    return String(fs.readFileSync(tokenPath(os, path), 'utf8')).trim();
  } catch (_e) {
    return '';
  }
}

function performDictionaryLookup({ payload, http, fs, os, path }) {
  const target =
    payload && typeof payload.target === 'string' ? payload.target.trim() : '';
  if (!target) {
    return Promise.resolve({ ok: false, error: 'No text selected.' });
  }

  const token = readToken({ fs, os, path });
  if (!token) {
    return Promise.resolve({
      ok: false,
      error: 'Dictionary app token not found. Launch Dictionary.app first.',
    });
  }

  const body = JSON.stringify({
    target,
    context: payload.context || target,
    containingSentence: payload.containingSentence || null,
    sourceApp: 'Markdown Vault App',
  });

  return new Promise((resolve) => {
    const req = http.request(
      {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: SERVER_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        // Drain the response so the socket can close; we only need the status.
        res.resume();
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          resolve({ ok: true });
        } else if (status === 401) {
          resolve({
            ok: false,
            error: 'Token rejected. Copy a fresh token from the Dictionary menu bar.',
          });
        } else if (status === 503) {
          resolve({ ok: false, error: 'Translation service error (model offline?).' });
        } else {
          resolve({ ok: false, error: `Dictionary server returned ${status}.` });
        }
      }
    );
    req.on('error', () => {
      resolve({
        ok: false,
        error: 'Dictionary app is not running. Launch it from Spotlight, then retry.',
      });
    });
    req.write(body);
    req.end();
  });
}

module.exports = { performDictionaryLookup, readToken, tokenPath };
