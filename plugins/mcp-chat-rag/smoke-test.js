const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fail(msg) {
  console.error('SMOKE FAIL:', msg);
  process.exitCode = 1;
}

function jsonLine(obj) { return JSON.stringify(obj) + '\n'; }

async function readUntil(stream, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (predicate(msg)) {
            cleanup();
            resolve(msg);
            return;
          }
        } catch (e) {
          // not JSON; ignore
        }
      }
    };
    const onErr = (err) => { cleanup(); reject(err); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);
    function cleanup() {
      stream.off('data', onData);
      stream.off('error', onErr);
      clearTimeout(timer);
    }
    stream.on('data', onData);
    stream.on('error', onErr);
  });
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-chat-rag-smoke-'));
  const dbFile = path.join(tmpDir, 'index.db');
  const rootDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(rootDir, { recursive: true });

  const env = {
    ...process.env,
    MCP_CHAT_RAG_DB: dbFile,
    MCP_CHAT_RAG_ROOT: rootDir,
    MCP_CHAT_RAG_NO_INDEX: '1', // skip background indexing for predictability
    MCP_CHAT_RAG_DEFAULT_PROJECT: '/proj/X'
  };

  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', (c) => process.stderr.write('[server.stderr] ' + c));

  try {
    // T9.1 — initialize
    child.stdin.write(jsonLine({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    const init = await readUntil(child.stdout, m => m.id === 1);
    if (!init.result || !init.result.protocolVersion) fail('initialize: missing protocolVersion');
    if (!init.result.serverInfo || init.result.serverInfo.name !== 'mcp-chat-rag') fail('initialize: wrong serverInfo');

    // T9.2 — tools/list
    child.stdin.write(jsonLine({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const tools = await readUntil(child.stdout, m => m.id === 2);
    const toolNames = (tools.result && tools.result.tools || []).map(t => t.name).sort();
    const expected = ['get_session', 'list_recent_sessions', 'search_chats'];
    if (JSON.stringify(toolNames) !== JSON.stringify(expected)) {
      fail(`tools/list: got ${JSON.stringify(toolNames)}, expected ${JSON.stringify(expected)}`);
    }

    // T9.3 — tools/call search_chats against empty index
    child.stdin.write(jsonLine({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'search_chats', arguments: { query: 'anything', k: 3 } }
    }));
    const search = await readUntil(child.stdout, m => m.id === 3);
    if (!search.result) fail('search_chats: missing result, error=' + JSON.stringify(search.error));
    else {
      if (!Array.isArray(search.result.content) || search.result.content[0].type !== 'text') {
        fail('search_chats: missing MCP content array');
      }
      const sc = search.result.structuredContent;
      if (!sc || !Array.isArray(sc.results)) fail('search_chats: structuredContent.results not an array');
      else if (!Array.isArray(sc.warnings) || !sc.warnings.includes('index_empty')) {
        fail('search_chats: expected index_empty warning on empty DB');
      }
    }

    // T9.4 — shutdown
    child.kill('SIGTERM');
    const exitCode = await new Promise(r => child.on('exit', code => r(code)));
    if (exitCode !== null && exitCode !== 0 && exitCode !== 143) {
      fail(`server did not exit cleanly: code=${exitCode}`);
    }

    if (process.exitCode === 1) {
      console.error('smoke: FAIL');
    } else {
      console.log('smoke: OK');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('smoke crashed:', err.stack || err.message);
  process.exitCode = 1;
});
