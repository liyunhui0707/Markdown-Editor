const test = require('node:test');
const assert = require('node:assert/strict');

const { handlers, listTools } = require('../lib/handler-registry');

const PING_SCHEMA = {
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
};

const INGEST_SCHEMA = {
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
};

test('registry exposes ping and ingest_chat_markdown handlers as callables', () => {
  assert.equal(typeof handlers.ping, 'function');
  assert.equal(typeof handlers.ingest_chat_markdown, 'function');
});

test('listTools includes ping and ingest_chat_markdown with object inputSchema', () => {
  const tools = listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('ping'));
  assert.ok(names.includes('ingest_chat_markdown'));
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('ping schema is byte-frozen against the current server.js declaration', () => {
  const tools = listTools();
  const ping = tools.find((t) => t.name === 'ping');
  assert.deepStrictEqual(ping, PING_SCHEMA);
});

test('ingest_chat_markdown schema is byte-frozen against the current server.js declaration', () => {
  const tools = listTools();
  const ingest = tools.find((t) => t.name === 'ingest_chat_markdown');
  assert.deepStrictEqual(ingest, INGEST_SCHEMA);
});
