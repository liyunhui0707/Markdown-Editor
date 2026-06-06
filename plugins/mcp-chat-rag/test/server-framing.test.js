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
    const slice = buffer.subarray(cursor);
    const sepIdx = slice.indexOf(separator);
    if (sepIdx === -1) throw new Error('partial header');
    const headerText = slice.subarray(0, sepIdx).toString('utf8');
    const match = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!match) throw new Error('frame without Content-Length');
    const len = Number(match[1]);
    const start = cursor + sepIdx + separator.length;
    const end = start + len;
    if (buffer.length < end) throw new Error('frame truncated');
    messages.push(JSON.parse(buffer.subarray(start, end).toString('utf8')));
    cursor = end;
  }
  return messages;
}

test('T10.1 LSP framing round-trips a CJK + emoji query by byte length, not code units', async () => {
  // Content-Length is a BYTE count, but the old read buffer was a UTF-8-decoded
  // string measured in UTF-16 code units. A CJK/emoji body has more bytes than
  // code units, so the server's "do I have the whole body yet?" check never
  // succeeded and it hung forever. This sends one framed request whose body is
  // multi-byte; the buggy server times out, the byte-framed server responds.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-rag-cjk-'));
  const env = {
    ...process.env,
    MCP_CHAT_RAG_DB: path.join(tmpDir, 'index.db'),
    MCP_CHAT_RAG_ROOT: path.join(tmpDir, 'projects'),
    MCP_CHAT_RAG_NO_INDEX: '1', // keep the server quiet and deterministic
    MCP_CHAT_RAG_DEFAULT_PROJECT: '/proj/X'
  };
  fs.mkdirSync(env.MCP_CHAT_RAG_ROOT, { recursive: true });

  const child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdoutBuffer = Buffer.alloc(0);
  child.stdout.on('data', (chunk) => { stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]); });
  child.stderr.on('data', () => {}); // drain
  const exitPromise = new Promise((resolve) => child.on('exit', () => resolve()));

  try {
    writeFrame(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    writeFrame(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'search_chats', arguments: { query: '我们之前讨论过什么？🔍 検索クエリ', k: 3 } }
    });

    let seenMessages = [];
    await new Promise((resolve, reject) => {
      let timeout, interval;
      const cleanup = () => { clearTimeout(timeout); clearInterval(interval); };
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for CJK response (id=2): server hung on byte/code-unit framing mismatch'));
      }, 5000);
      interval = setInterval(() => {
        let messages;
        try {
          messages = parseAllFrames(stdoutBuffer);
        } catch {
          return; // partial frame, keep waiting
        }
        if (messages.some((m) => m.id === 2)) {
          cleanup();
          seenMessages = messages;
          resolve();
        }
      }, 25);
    });

    const resp = seenMessages.find((m) => m.id === 2);
    assert.ok(resp, 'missing response for id=2');
    assert.ok(
      resp.result,
      `search_chats over LSP should return a result, got error=${JSON.stringify(resp.error)}`
    );
  } finally {
    child.kill();
    await exitPromise;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
