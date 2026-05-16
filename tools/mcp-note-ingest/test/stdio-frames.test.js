const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');

function writeFrame(child, message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, 'utf8');
  const header = Buffer.from(
    `Content-Length: ${payload.length}\r\nContent-Type: application/json\r\n\r\n`,
    'utf8'
  );
  child.stdin.write(Buffer.concat([header, payload]));
}

function parseAllFrames(buffer) {
  const separator = '\r\n\r\n';
  const messages = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const sliceForHeader = buffer.slice(cursor);
    const separatorIndex = sliceForHeader.indexOf(separator);
    if (separatorIndex === -1) {
      throw new Error(
        `Trailing non-frame bytes at offset ${cursor}: ${JSON.stringify(
          sliceForHeader.toString('utf8').slice(0, 80)
        )}`
      );
    }
    const headerText = sliceForHeader.slice(0, separatorIndex).toString('utf8');
    const match = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      throw new Error(`Frame without Content-Length at offset ${cursor}`);
    }
    const contentLength = Number(match[1]);
    const messageStart = cursor + separatorIndex + separator.length;
    const messageEnd = messageStart + contentLength;
    if (buffer.length < messageEnd) {
      throw new Error(
        `Frame truncated: header says ${contentLength} bytes, only ${
          buffer.length - messageStart
        } available`
      );
    }
    const payload = buffer.slice(messageStart, messageEnd).toString('utf8');
    messages.push(JSON.parse(payload));
    cursor = messageEnd;
  }

  return messages;
}

test('stdout is well-framed JSON-RPC for the full ping + ingest session', async () => {
  const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-note-ingest-frames-'));

  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdoutBuffer = Buffer.alloc(0);
  let stderrBuffer = Buffer.alloc(0);
  child.stdout.on('data', (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
  });
  child.stderr.on('data', (chunk) => {
    stderrBuffer = Buffer.concat([stderrBuffer, chunk]);
  });

  const exitPromise = new Promise((resolve) => {
    child.on('exit', () => resolve());
  });

  writeFrame(child, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'stdio-frames-test', version: '0.0.1' }
    }
  });
  writeFrame(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
  writeFrame(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  writeFrame(child, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'ping', arguments: { message: 'hi' } }
  });
  writeFrame(child, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'ingest_chat_markdown',
      arguments: {
        vault_path: tempVault,
        title: 'Frames Test',
        body: 'body',
        source: 'claude'
      }
    }
  });

  // Wait for the four responses (ids 1..4) before killing the child.
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timeout waiting for 4 responses')),
      5000
    );
    const checkInterval = setInterval(() => {
      try {
        const messages = parseAllFrames(stdoutBuffer);
        if (messages.length >= 4) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        }
      } catch {
        // partial frame, keep waiting
      }
    }, 25);
  });

  child.kill();
  await exitPromise;

  // Assertion 1: every byte of stdout is consumed by frame parsing.
  const messages = parseAllFrames(stdoutBuffer);

  // Assertion 2: each parsed frame is well-formed JSON-RPC 2.0.
  assert.ok(messages.length >= 4, `expected >=4 framed messages, got ${messages.length}`);
  for (const msg of messages) {
    assert.equal(msg.jsonrpc, '2.0');
  }

  // Assertion 3: the four responses we expected are present, by id.
  const idsSeen = new Set(messages.filter((m) => 'id' in m).map((m) => m.id));
  for (const expectedId of [1, 2, 3, 4]) {
    assert.ok(idsSeen.has(expectedId), `missing response for id=${expectedId}`);
  }

  // Assertion 4: stderr is non-empty (logger fired for protocol detect + ingest ok).
  assert.ok(
    stderrBuffer.length > 0,
    'expected non-empty stderr from logger (protocol + ingest ok)'
  );

  // Assertion 5: stderr never appears on stdout. Look for the logger's `[mcp-note-ingest]` prefix.
  assert.equal(
    stdoutBuffer.toString('utf8').includes('[mcp-note-ingest]'),
    false,
    'logger output must never appear on stdout'
  );
});
