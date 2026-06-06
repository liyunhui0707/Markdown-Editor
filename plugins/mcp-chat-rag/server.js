const path = require('path');
const os = require('os');
const { openStore } = require('./lib/store');
const { createEmbedder } = require('./lib/embedder');
const { indexAll } = require('./lib/indexer');
const { createRegistry } = require('./lib/handler-registry');
const { mapToolErrorToJsonRpc } = require('./lib/tool-error');
const { logToStderr } = require('./lib/logger');

const SERVER_INFO = { name: 'mcp-chat-rag', version: '0.1.1' };

function log(message) { logToStderr('mcp-chat-rag', message); }

function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return p;
}

const DB_PATH = expandHome(process.env.MCP_CHAT_RAG_DB) ||
  path.join(os.homedir(), '.cache', 'mcp-chat-rag', 'index.db');
const SOURCE_ROOT = expandHome(process.env.MCP_CHAT_RAG_ROOT) ||
  path.join(os.homedir(), '.claude', 'projects');
const OLLAMA_URL = process.env.MCP_CHAT_RAG_OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_PROJECT = process.env.MCP_CHAT_RAG_DEFAULT_PROJECT ||
  process.env.PWD || process.env.INIT_CWD || process.cwd();
const SKIP_INDEXING = process.env.MCP_CHAT_RAG_NO_INDEX === '1';

let indexing = false;
let store, embedder, registry;

function init() {
  store = openStore(DB_PATH);
  embedder = createEmbedder({ baseUrl: OLLAMA_URL });
  registry = createRegistry({
    store,
    embedder,
    defaultProject: DEFAULT_PROJECT,
    isIndexing: () => indexing
  });
  log(`booted (db=${DB_PATH} root=${SOURCE_ROOT} project=${DEFAULT_PROJECT})`);
  if (!SKIP_INDEXING) {
    indexing = true;
    indexAll({ store, embedder, root: SOURCE_ROOT })
      .then(stats => {
        log(`indexAll done: ${JSON.stringify(stats)}`);
        indexing = false;
      })
      .catch(err => {
        log(`indexAll failed: ${err.stack || err.message}`);
        indexing = false;
      });
  }
}

// Read-path buffer is a raw Buffer, not a string: Content-Length is a BYTE
// count, but a UTF-8-decoded string measures UTF-16 code units, so any CJK or
// emoji body would desync framing (hang or truncate). Frame by bytes here.
let inputBuffer = Buffer.alloc(0);
let protocol = null;

function writeMessage(message) {
  const json = JSON.stringify(message);
  if (protocol === 'lsp') {
    const payload = Buffer.from(json, 'utf8');
    process.stdout.write(`Content-Length: ${payload.length}\r\nContent-Type: application/json\r\n\r\n`);
    process.stdout.write(payload);
  } else {
    process.stdout.write(json + '\n');
  }
}

function writeResponse(id, result) { writeMessage({ jsonrpc: '2.0', id, result }); }
function writeError(id, code, message, data = null) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message, data } });
}

function tryReadMessage() {
  if (protocol === null) {
    if (inputBuffer.length === 0) return null;
    if (inputBuffer.indexOf('Content-Length:') === 0) { protocol = 'lsp'; }
    else if (inputBuffer.toString('utf8').trimStart().startsWith('{')) { protocol = 'ndjson'; }
    else return null;
  }

  if (protocol === 'lsp') {
    const sep = '\r\n\r\n';
    const sepLen = Buffer.byteLength(sep);
    const sepIdx = inputBuffer.indexOf(sep);       // byte offset
    if (sepIdx === -1) return null;
    const headers = inputBuffer.subarray(0, sepIdx).toString('utf8');
    const m = headers.match(/Content-Length:\s*(\d+)/i);
    if (!m) throw new Error('missing Content-Length');
    const len = Number(m[1]);                      // byte length of body
    const start = sepIdx + sepLen;
    if (inputBuffer.length < start + len) return null;  // both are byte counts
    const body = inputBuffer.subarray(start, start + len).toString('utf8');
    inputBuffer = inputBuffer.subarray(start + len);
    return JSON.parse(body);
  }

  const nl = inputBuffer.indexOf(0x0a);            // '\n' byte; safe in UTF-8
  if (nl === -1) return null;
  const line = inputBuffer.subarray(0, nl).toString('utf8').trim();
  inputBuffer = inputBuffer.subarray(nl + 1);
  if (!line) return null;
  return JSON.parse(line);
}

async function handleToolCall(id, params) {
  const toolName = params && params.name;
  const argumentsObject = (params && params.arguments) || {};
  const handler = registry.handlers[toolName];
  if (!handler) { writeError(id, -32601, `Unknown tool: ${toolName}`); return; }
  try {
    const result = await handler(argumentsObject);
    writeResponse(id, result);
  } catch (err) {
    const mapped = mapToolErrorToJsonRpc(err);
    if (mapped) {
      writeError(id, mapped.code, mapped.message, mapped.data);
      return;
    }
    log(`tool ${toolName} threw: ${err.stack || err.message}`);
    writeError(id, -32603, 'Internal error', { detail: err.message });
  }
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (!method) { writeError(id ?? null, -32600, 'Invalid Request: missing method.'); return; }
  if (method === 'initialize') {
    writeResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') { writeResponse(id, { tools: registry.listTools() }); return; }
  if (method === 'tools/call') { await handleToolCall(id, params); return; }
  writeError(id, -32601, `Method not found: ${method}`);
}

async function processInputChunk(chunk) {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (true) {
    let message;
    try { message = tryReadMessage(); }
    catch (err) {
      writeError(null, -32700, 'Parse error', { detail: err.message });
      inputBuffer = Buffer.alloc(0); protocol = null;
      return;
    }
    if (!message) return;
    try { await handleRequest(message); }
    catch (err) {
      const rid = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : null;
      log(`request error: ${err.stack || err.message}`);
      writeError(rid, -32603, 'Internal error', { detail: err.message });
    }
  }
}

init();
process.stdin.on('data', processInputChunk);
process.stdin.on('error', (err) => log(`STDIN error: ${err.message}`));
process.stdout.on('error', (err) => log(`STDOUT error: ${err.message}`));
process.on('uncaughtException', (err) => log(`Uncaught exception: ${err.stack || err.message}`));
process.on('unhandledRejection', (reason) => log(`Unhandled rejection: ${String(reason)}`));
