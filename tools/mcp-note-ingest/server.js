const fs = require('fs');

const SERVER_INFO = {
  name: 'mcp-note-ingest',
  version: '0.1.0'
};

let inputBuffer = Buffer.alloc(0);

function writeMessage(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, 'utf8');
  const header = Buffer.from(
    `Content-Length: ${payload.length}\r\nContent-Type: application/json\r\n\r\n`,
    'utf8'
  );

  process.stdout.write(Buffer.concat([header, payload]));
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

function parseHeaders(headerText) {
  const lines = headerText.split('\r\n');
  const headers = {};

  for (const line of lines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[key] = value;
  }

  return headers;
}

function tryReadMessage() {
  const separator = '\r\n\r\n';
  const separatorIndex = inputBuffer.indexOf(separator);

  if (separatorIndex === -1) {
    return null;
  }

  const headerBuffer = inputBuffer.slice(0, separatorIndex);
  const headerText = headerBuffer.toString('utf8');
  const headers = parseHeaders(headerText);

  const contentLength = Number(headers['content-length']);

  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error('Invalid or missing Content-Length header.');
  }

  const messageStart = separatorIndex + separator.length;
  const messageEnd = messageStart + contentLength;

  if (inputBuffer.length < messageEnd) {
    return null;
  }

  const messageBuffer = inputBuffer.slice(messageStart, messageEnd);
  inputBuffer = inputBuffer.slice(messageEnd);

  return JSON.parse(messageBuffer.toString('utf8'));
}

function listToolsResult() {
  return {
    tools: [
      {
        name: 'ping',
        description: 'Simple smoke-test tool that proves the MCP server is working.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            message: {
              type: 'string',
              description: 'Optional message to echo back.'
            }
          }
        }
      }
    ]
  };
}

function handlePing(argumentsObject) {
  const message =
    argumentsObject && typeof argumentsObject.message === 'string'
      ? argumentsObject.message
      : 'pong';

  return {
    content: [
      {
        type: 'text',
        text: `ping ok: ${message}`
      }
    ]
  };
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
      capabilities: {
        tools: {}
      },
      serverInfo: SERVER_INFO
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    writeResponse(id, listToolsResult());
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const argumentsObject = params?.arguments || {};

    if (toolName === 'ping') {
      writeResponse(id, handlePing(argumentsObject));
      return;
    }

    writeError(id, -32601, `Unknown tool: ${toolName}`);
    return;
  }

  writeError(id, -32601, `Method not found: ${method}`);
}

function processInputChunk(chunk) {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);

  while (true) {
    let message;

    try {
      message = tryReadMessage();
    } catch (error) {
      writeError(null, -32700, 'Parse error', { detail: error.message });
      inputBuffer = Buffer.alloc(0);
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

      writeError(requestId, -32603, 'Internal error', {
        detail: error.message
      });
    }
  }
}

process.stdin.on('data', processInputChunk);

process.stdin.on('error', (error) => {
  fs.writeSync(process.stderr.fd, `STDIN error: ${error.message}\n`);
});

process.stdout.on('error', (error) => {
  fs.writeSync(process.stderr.fd, `STDOUT error: ${error.message}\n`);
});

process.on('uncaughtException', (error) => {
  fs.writeSync(process.stderr.fd, `Uncaught exception: ${error.stack || error.message}\n`);
});

process.on('unhandledRejection', (reason) => {
  fs.writeSync(process.stderr.fd, `Unhandled rejection: ${String(reason)}\n`);
});