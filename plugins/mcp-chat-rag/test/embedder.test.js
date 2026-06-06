const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createEmbedder, OllamaUnreachableError, OllamaHttpError, EmbeddingDimError } = require('../lib/embedder');

function startStubServer(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(() => r())) });
    });
  });
}

test('T6.1 embedBatch POSTs to /api/embeddings with model and prompt', async () => {
  const captured = [];
  const stub = await startStubServer(async (req, res) => {
    if (req.url === '/api/embeddings' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        captured.push(JSON.parse(body));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ embedding: new Array(768).fill(0.01) }));
      });
    } else {
      res.statusCode = 404;
      res.end();
    }
  });

  const embedder = createEmbedder({ baseUrl: stub.url, model: 'nomic-embed-text', expectedDim: 768 });
  const out = await embedder.embedBatch(['hello', 'world']);

  assert.equal(out.length, 2);
  assert.ok(out[0] instanceof Float32Array);
  assert.equal(out[0].length, 768);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].model, 'nomic-embed-text');
  assert.equal(captured[0].prompt, 'hello');
  assert.equal(captured[1].prompt, 'world');

  await stub.close();
});

test('T6.4 retries with a truncated prompt when Ollama 500s on context overflow', async () => {
  // Dense content (logs/code/separators) tokenizes far denser than the len/4
  // estimate, so a within-char-budget chunk can still exceed the embed model's
  // token context. The embedder must shrink and retry rather than fail the
  // whole chunk (and, via embedBatch, the whole session's vectors).
  const LIMIT = 1000;
  const seenLengths = [];
  const stub = await startStubServer(async (req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const { prompt } = JSON.parse(body);
      seenLengths.push(prompt.length);
      if (prompt.length > LIMIT) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'the input length exceeds the context length' }));
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ embedding: new Array(768).fill(0.02) }));
    });
  });

  const embedder = createEmbedder({ baseUrl: stub.url, model: 'nomic-embed-text', expectedDim: 768 });
  const out = await embedder.embedBatch(['x'.repeat(4000)]);

  assert.equal(out.length, 1);
  assert.ok(out[0] instanceof Float32Array);
  assert.equal(out[0].length, 768);
  // First attempt overflowed; a later attempt fit under the limit.
  assert.ok(seenLengths[0] > LIMIT, `first attempt should be the full prompt, got ${seenLengths[0]}`);
  assert.ok(seenLengths[seenLengths.length - 1] <= LIMIT, 'final attempt should fit under the limit');

  await stub.close();
});

test('T6.5 a non-overflow 500 is not retried and surfaces as OllamaHttpError', async () => {
  let attempts = 0;
  const stub = await startStubServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      attempts++;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'model runner has unexpectedly stopped' }));
    });
  });
  const embedder = createEmbedder({ baseUrl: stub.url, model: 'nomic-embed-text', expectedDim: 768 });
  let caught;
  try {
    await embedder.embedBatch(['hello']);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof OllamaHttpError, `expected OllamaHttpError, got ${caught && caught.name}`);
  assert.equal(attempts, 1, 'a non-overflow 500 must not be retried');
  await stub.close();
});

test('T6.2 connection refused throws OllamaUnreachableError', async () => {
  const embedder = createEmbedder({ baseUrl: 'http://127.0.0.1:1', model: 'nomic-embed-text', expectedDim: 768 });
  let caught;
  try {
    await embedder.embedBatch(['x']);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof OllamaUnreachableError, `expected OllamaUnreachableError, got ${caught && caught.name}`);
});

test('T6.3 dim mismatch throws EmbeddingDimError', async () => {
  const stub = await startStubServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ embedding: new Array(512).fill(0.0) })); // wrong dim
    });
  });
  const embedder = createEmbedder({ baseUrl: stub.url, model: 'nomic-embed-text', expectedDim: 768 });
  let caught;
  try {
    await embedder.embedBatch(['x']);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof EmbeddingDimError, `expected EmbeddingDimError, got ${caught && caught.name}`);
  await stub.close();
});
