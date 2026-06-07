/* Dictionary lookup — main-process helper.
   Run focused: node --test test/dictionary-lookup.test.js

   performDictionaryLookup reads the local Dictionary.app token and POSTs the
   captured selection to its loopback server. All side-effecting dependencies
   (http, fs, os, path) are injected so we exercise the logic without sockets
   or a real token file. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('node:path');

const MODULE_REL = '../lib/dictionary-lookup.js';

function loadModule() {
  delete require.cache[require.resolve(MODULE_REL)];
  return require(MODULE_REL);
}

// Fake os/fs that serve a token (or simulate a missing file).
function makeEnv({ token = 'tok-123', tokenThrows = false } = {}) {
  const os = { homedir: () => '/Users/test' };
  const fs = {
    readFileSync: () => {
      if (tokenThrows) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return `  ${token}\n`;
    },
  };
  return { os, fs, path };
}

// Fake http.request that captures the request and drives the response with a
// chosen status code. `networkError` makes it emit 'error' instead.
function makeHttp({ status = 200, networkError = false } = {}) {
  const captured = {};
  const http = {
    request(options, callback) {
      captured.options = options;
      let written = '';
      const errorHandlers = [];
      const req = {
        on(event, handler) {
          if (event === 'error') errorHandlers.push(handler);
          return req;
        },
        write(chunk) {
          written += chunk;
        },
        end() {
          captured.body = written;
          if (networkError) {
            errorHandlers.forEach((h) => h(new Error('ECONNREFUSED')));
            return;
          }
          const res = { statusCode: status, resume() {} };
          callback(res);
        },
      };
      return req;
    },
  };
  return { http, captured };
}

test('rejects when no target text is selected', async () => {
  const { performDictionaryLookup } = loadModule();
  const { os, fs } = makeEnv();
  const { http } = makeHttp();
  const result = await performDictionaryLookup({
    payload: { target: '   ' },
    http,
    fs,
    os,
    path,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /No text selected/);
});

test('rejects when the token file is missing', async () => {
  const { performDictionaryLookup } = loadModule();
  const { os, fs } = makeEnv({ tokenThrows: true });
  const { http } = makeHttp();
  const result = await performDictionaryLookup({
    payload: { target: 'bank' },
    http,
    fs,
    os,
    path,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /token not found/i);
});

test('posts Bearer token + body and returns ok on 2xx', async () => {
  const { performDictionaryLookup } = loadModule();
  const { os, fs } = makeEnv({ token: 'secret-xyz' });
  const { http, captured } = makeHttp({ status: 200 });
  const result = await performDictionaryLookup({
    payload: {
      target: 'bank',
      context: 'I sat on the river bank.',
      containingSentence: 'I sat on the river bank.',
    },
    http,
    fs,
    os,
    path,
  });
  assert.equal(result.ok, true);
  assert.equal(captured.options.headers.Authorization, 'Bearer secret-xyz');
  assert.equal(captured.options.host, '127.0.0.1');
  assert.equal(captured.options.port, 49152);
  assert.equal(captured.options.path, '/v1/translate');
  const sent = JSON.parse(captured.body);
  assert.equal(sent.target, 'bank');
  assert.equal(sent.context, 'I sat on the river bank.');
  assert.equal(sent.sourceApp, 'Markdown Vault App');
});

test('falls back to target when no context is provided', async () => {
  const { performDictionaryLookup } = loadModule();
  const { os, fs } = makeEnv();
  const { http, captured } = makeHttp({ status: 204 });
  const result = await performDictionaryLookup({
    payload: { target: 'bank' },
    http,
    fs,
    os,
    path,
  });
  assert.equal(result.ok, true);
  const sent = JSON.parse(captured.body);
  assert.equal(sent.context, 'bank');
  assert.equal(sent.containingSentence, null);
});

test('maps 401 to a token-rejected message', async () => {
  const { performDictionaryLookup } = loadModule();
  const { os, fs } = makeEnv();
  const { http } = makeHttp({ status: 401 });
  const result = await performDictionaryLookup({
    payload: { target: 'bank' },
    http,
    fs,
    os,
    path,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Token rejected/);
});

test('maps 503 to a service-error message', async () => {
  const { performDictionaryLookup } = loadModule();
  const { os, fs } = makeEnv();
  const { http } = makeHttp({ status: 503 });
  const result = await performDictionaryLookup({
    payload: { target: 'bank' },
    http,
    fs,
    os,
    path,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /service error/i);
});

test('maps other non-2xx to a generic status message', async () => {
  const { performDictionaryLookup } = loadModule();
  const { os, fs } = makeEnv();
  const { http } = makeHttp({ status: 500 });
  const result = await performDictionaryLookup({
    payload: { target: 'bank' },
    http,
    fs,
    os,
    path,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /returned 500/);
});

test('maps a network error to an app-not-running message', async () => {
  const { performDictionaryLookup } = loadModule();
  const { os, fs } = makeEnv();
  const { http } = makeHttp({ networkError: true });
  const result = await performDictionaryLookup({
    payload: { target: 'bank' },
    http,
    fs,
    os,
    path,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not running/i);
});

test('tokenPath builds the Application Support path', () => {
  const { tokenPath } = loadModule();
  const os = { homedir: () => '/Users/test' };
  const result = tokenPath(os, path);
  assert.equal(
    result,
    path.join('/Users/test', 'Library', 'Application Support', 'DictionaryApp', 'token')
  );
});
