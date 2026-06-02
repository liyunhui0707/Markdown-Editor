const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createEmbedder, OllamaUnreachableError, EmbeddingDimError } = require('../lib/embedder');

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
