const fs = require('fs');
const path = require('path');

const SERVER_INFO = {
  name: 'mcp-note-ingest',
  version: '0.2.0'
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

function tryReadMessage() {
  const separator = '\r\n\r\n';
  const separatorIndex = inputBuffer.indexOf(separator);

  if (separatorIndex === -1) {
    return null;
  }

  const headerText = inputBuffer.slice(0, separatorIndex).toString('utf8');
  const match = headerText.match(/Content-Length:\s*(\d+)/i);

  if (!match) {
    throw new Error('Missing Content-Length header');
  }

  const contentLength = Number(match[1]);
  const messageStart = separatorIndex + separator.length;
  const messageEnd = messageStart + contentLength;

  if (inputBuffer.length < messageEnd) {
    return null;
  }

  const messageBuffer = inputBuffer.slice(messageStart, messageEnd);
  inputBuffer = inputBuffer.slice(messageEnd);

  return JSON.parse(messageBuffer.toString('utf8'));
}

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
}

function escapeYamlString(value) {
  return String(value).replace(/"/g, '\\"');
}

function normalizeTags(tags) {
  if (!tags) {
    return [];
  }

  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildFrontmatter({ source, createdAt, model, tags }) {
  const lines = [];

  if (source) {
    lines.push(`source: "${escapeYamlString(source)}"`);
  }

  if (createdAt) {
    lines.push(`created_at: "${escapeYamlString(createdAt)}"`);
  }

  if (model) {
    lines.push(`model: "${escapeYamlString(model)}"`);
  }

  const normalizedTags = normalizeTags(tags);
  if (normalizedTags.length > 0) {
    const serializedTags = normalizedTags.map((tag) => `"${escapeYamlString(tag)}"`).join(', ');
    lines.push(`tags: [${serializedTags}]`);
  }

  if (lines.length === 0) {
    return '';
  }

  return `---\n${lines.join('\n')}\n---\n\n`;
}

function buildMarkdownDocument({ title, body, source, createdAt, model, tags }) {
  const frontmatter = buildFrontmatter({
    source,
    createdAt,
    model,
    tags
  });

  return `${frontmatter}# ${title}\n\n${body}\n`;
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
  const rawTitle = String(argumentsObject?.title || '').trim();
  const rawBody = String(argumentsObject?.body || '');
  const source = String(argumentsObject?.source || '').trim();
  const model = argumentsObject?.model ? String(argumentsObject.model).trim() : '';
  const createdAt =
    argumentsObject?.created_at && String(argumentsObject.created_at).trim()
      ? String(argumentsObject.created_at).trim()
      : new Date().toISOString();

  const tags = normalizeTags(argumentsObject?.tags);

  if (!vaultPath) {
    throw new Error('vault_path is required.');
  }

  if (!path.isAbsolute(vaultPath)) {
    throw new Error('vault_path must be an absolute path.');
  }

  if (!rawTitle) {
    throw new Error('title is required.');
  }

  if (!source) {
    throw new Error('source is required.');
  }

  const title = rawTitle;
  const body = rawBody.trim() ? rawBody : 'No body provided.';
  const safeTitle = sanitizeFileName(title) || 'untitled-chat';
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    throw new Error('created_at must be a valid ISO date string.');
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  const relativeDir = path.join('Inbox', 'AI Chats', year, month);
  const targetDir = path.join(vaultPath, relativeDir);
  ensureDirExists(targetDir);

  const timestampPart = [
    year,
    month,
    String(date.getUTCDate()).padStart(2, '0')
  ].join('') +
    '-' +
    [
      String(date.getUTCHours()).padStart(2, '0'),
      String(date.getUTCMinutes()).padStart(2, '0'),
      String(date.getUTCSeconds()).padStart(2, '0')
    ].join('');

  const fileName = `${timestampPart}-${safeTitle}.md`;
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
      created_at: createdAt
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
      protocolVersion: '2025-03-26',
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