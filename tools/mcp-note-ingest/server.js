const { handlers, listTools } = require('./lib/handler-registry');
const { mapToolErrorToJsonRpc } = require('./lib/tool-error');
const { logToStderr } = require('./lib/logger');

const SERVER_INFO = {
  name: 'mcp-note-ingest',
  version: '0.4.0'
};

let inputBuffer = '';
// null = not yet detected, 'ndjson' = newline-delimited, 'lsp' = Content-Length framing
let protocol = null;

function log(message) {
  logToStderr('mcp-note-ingest', message);
}

function writeMessage(message) {
  const json = JSON.stringify(message);
  if (protocol === 'lsp') {
    const payload = Buffer.from(json, 'utf8');
    process.stdout.write(
      `Content-Length: ${payload.length}\r\nContent-Type: application/json\r\n\r\n`
    );
    process.stdout.write(payload);
  } else {
    process.stdout.write(json + '\n');
  }
}

function writeResponse(id, result) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    result
  });
}

function writeError(id, code, message, data = null) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data
    }
  });
}

function tryReadMessage() {
  if (protocol === null) {
    if (inputBuffer.startsWith('Content-Length:')) {
      protocol = 'lsp';
      log('protocol: lsp (Content-Length)');
    } else if (inputBuffer.trimStart().startsWith('{')) {
      protocol = 'ndjson';
      log('protocol: ndjson');
    } else {
      return null;
    }
  }

  if (protocol === 'lsp') {
    const separator = '\r\n\r\n';
    const separatorIndex = inputBuffer.indexOf(separator);
    if (separatorIndex === -1) return null;

    const headerText = inputBuffer.slice(0, separatorIndex);
    const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) throw new Error('Invalid or missing Content-Length header.');

    const contentLength = Number(contentLengthMatch[1]);
    const messageStart = separatorIndex + separator.length;
    if (inputBuffer.length < messageStart + contentLength) return null;

    const messageText = inputBuffer.slice(messageStart, messageStart + contentLength);
    inputBuffer = inputBuffer.slice(messageStart + contentLength);
    return JSON.parse(messageText);
  }

  // ndjson
  const newlineIndex = inputBuffer.indexOf('\n');
  if (newlineIndex === -1) return null;

  const line = inputBuffer.slice(0, newlineIndex).trim();
  inputBuffer = inputBuffer.slice(newlineIndex + 1);
  if (!line) return null;

  return JSON.parse(line);
}

function handleToolCall(id, params) {
  const toolName = params?.name;
  const argumentsObject = params?.arguments || {};
  const handler = handlers[toolName];
  if (!handler) {
    writeError(id, -32601, `Unknown tool: ${toolName}`);
    return;
  }

  try {
    writeResponse(id, handler(argumentsObject));
  } catch (err) {
    const mapped = mapToolErrorToJsonRpc(err);
    if (mapped) {
      writeError(id, mapped.code, mapped.message, mapped.data);
      return;
    }
    throw err;
  }
}

function handleRequest(message) {
  const { id, method, params } = message;

  if (!method) {
    writeError(id ?? null, -32600, 'Invalid Request: missing method.');
    return;
  }

  if (method === 'initialize') {
    writeResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    writeResponse(id, { tools: listTools() });
    return;
  }

  if (method === 'tools/call') {
    handleToolCall(id, params);
    return;
  }

  writeError(id, -32601, `Method not found: ${method}`);
}

function processInputChunk(chunk) {
  inputBuffer += chunk.toString('utf8');

  while (true) {
    let message;

    try {
      message = tryReadMessage();
    } catch (error) {
      writeError(null, -32700, 'Parse error', { detail: error.message });
      inputBuffer = '';
      protocol = null;
      return;
    }

    if (!message) {
      return;
    }

    try {
      handleRequest(message);
    } catch (error) {
      const requestId = Object.prototype.hasOwnProperty.call(message, 'id')
        ? message.id
        : null;

      log(`error | ${error.stack || error.message}`);

      writeError(requestId, -32603, 'Internal error', {
        detail: error.message
      });
    }
  }
}

process.stdin.on('data', processInputChunk);

process.stdin.on('error', (error) => {
  log(`STDIN error: ${error.message}`);
});

process.stdout.on('error', (error) => {
  log(`STDOUT error: ${error.message}`);
});

process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.stack || error.message}`);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${String(reason)}`);
});
