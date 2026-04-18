const fs = require('fs');
const path = require('path');
const {
  sanitizeFileName,
  normalizeTags,
  ensureDirExists,
  validateVaultPath,
  validateCreatedAt,
  normalizeTitle,
  normalizeBody,
  normalizeSource,
  normalizeModel,
  buildMarkdownDocument,
  buildTimestampPart,
  buildUniqueFileName
} = require('./lib/core');

const SERVER_INFO = {
  name: 'mcp-note-ingest',
  version: '0.4.0'
};

let inputBuffer = '';
// null = not yet detected, 'ndjson' = newline-delimited, 'lsp' = Content-Length framing
let protocol = null;

function logToStderr(message) {
  fs.writeSync(process.stderr.fd, `[mcp-note-ingest] ${message}\n`);
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
  // Auto-detect protocol on first data
  if (protocol === null) {
    if (inputBuffer.startsWith('Content-Length:')) {
      protocol = 'lsp';
      logToStderr('protocol: lsp (Content-Length)');
    } else if (inputBuffer.trimStart().startsWith('{')) {
      protocol = 'ndjson';
      logToStderr('protocol: ndjson');
    } else {
      return null; // wait for more data
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
      },
      {
        name: 'ingest_chat_markdown',
        description:
          'Write AI chat content into the vault as a Markdown file under Inbox/AI Chats/YYYY/MM/.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['vault_path', 'title', 'body', 'source'],
          properties: {
            vault_path: {
              type: 'string',
              description: 'Absolute path to the vault root folder.'
            },
            title: {
              type: 'string',
              description: 'Note title used for the Markdown heading and filename base.'
            },
            body: {
              type: 'string',
              description: 'Markdown body content to store below the heading.'
            },
            source: {
              type: 'string',
              description: 'Source system, such as claude, codex, chatgpt, or gemini.'
            },
            model: {
              type: 'string',
              description: 'Optional model name.'
            },
            created_at: {
              type: 'string',
              description: 'Optional ISO timestamp. Defaults to current UTC time.'
            },
            tags: {
              oneOf: [
                {
                  type: 'array',
                  items: { type: 'string' }
                },
                {
                  type: 'string'
                }
              ],
              description: 'Optional tags for frontmatter.'
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

function handleIngestChatMarkdown(argumentsObject) {
  const vaultPath = String(argumentsObject?.vault_path || '').trim();
  const title = normalizeTitle(argumentsObject?.title);
  const body = normalizeBody(argumentsObject?.body);
  const source = normalizeSource(argumentsObject?.source);
  const model = normalizeModel(argumentsObject?.model);
  const createdAt =
    argumentsObject?.created_at && String(argumentsObject.created_at).trim()
      ? String(argumentsObject.created_at).trim()
      : new Date().toISOString();

  validateVaultPath(vaultPath);

  const date = validateCreatedAt(createdAt);
  const tags = normalizeTags(argumentsObject?.tags);

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  const relativeDir = path.join('Inbox', 'AI Chats', year, month);
  const targetDir = path.join(vaultPath, relativeDir);
  ensureDirExists(targetDir);

  const timestampPart = buildTimestampPart(date);
  const safeTitle = sanitizeFileName(title) || 'untitled-chat';
  const fileName = buildUniqueFileName(targetDir, `${timestampPart}-${safeTitle}`);
  const fullPath = path.join(targetDir, fileName);
  const relativePath = path.join(relativeDir, fileName);

  const markdown = buildMarkdownDocument({
    title,
    body,
    source,
    createdAt,
    model,
    tags
  });

  fs.writeFileSync(fullPath, markdown, 'utf8');

  logToStderr(`ingest ok | source=${source} | path=${relativePath}`);

  return {
    content: [
      {
        type: 'text',
        text: [
          'ingest_chat_markdown ok',
          `title: ${title}`,
          `source: ${source}`,
          `relative_path: ${relativePath}`,
          `full_path: ${fullPath}`
        ].join('\n')
      }
    ],
    structuredContent: {
      ok: true,
      title,
      source,
      file_name: fileName,
      relative_path: relativePath,
      full_path: fullPath,
      created_at: createdAt,
      tags,
      model
    }
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

    if (toolName === 'ingest_chat_markdown') {
      writeResponse(id, handleIngestChatMarkdown(argumentsObject));
      return;
    }

    writeError(id, -32601, `Unknown tool: ${toolName}`);
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

      logToStderr(`error | ${error.stack || error.message}`);

      writeError(requestId, -32603, 'Internal error', {
        detail: error.message
      });
    }
  }
}

process.stdin.on('data', processInputChunk);

process.stdin.on('error', (error) => {
  logToStderr(`STDIN error: ${error.message}`);
});

process.stdout.on('error', (error) => {
  logToStderr(`STDOUT error: ${error.message}`);
});

process.on('uncaughtException', (error) => {
  logToStderr(`Uncaught exception: ${error.stack || error.message}`);
});

process.on('unhandledRejection', (reason) => {
  logToStderr(`Unhandled rejection: ${String(reason)}`);
});