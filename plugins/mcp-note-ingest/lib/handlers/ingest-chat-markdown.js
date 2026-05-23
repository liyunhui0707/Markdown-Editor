const fs = require('fs');
const path = require('path');

const {
  sanitizeFileName,
  normalizeTags,
  ensureDirExists,
  validateCreatedAt,
  normalizeTitle,
  normalizeBody,
  normalizeSource,
  normalizeModel,
  buildMarkdownDocument,
  buildTimestampPart,
  buildUniqueFileName
} = require('../core');
const { logToStderr } = require('../logger');

const DEFAULT_TARGET_DIR = '/Users/liyunhui/Liyunhui/Inbox';

const schema = {
  name: 'ingest_chat_markdown',
  description:
    'Write AI chat content as a Markdown file into the fixed local Inbox folder.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'body', 'source'],
    properties: {
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

function resolveTargetDir() {
  const fromEnv = process.env.MCP_INGEST_TARGET_DIR;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  return DEFAULT_TARGET_DIR;
}

function createIngestChatMarkdownHandler(deps = {}) {
  const targetDir = deps.targetDir || resolveTargetDir();

  return function handler(argumentsObject) {
    const title = normalizeTitle(argumentsObject?.title);
    const body = normalizeBody(argumentsObject?.body);
    const source = normalizeSource(argumentsObject?.source);
    const model = normalizeModel(argumentsObject?.model);
    const createdAt =
      argumentsObject?.created_at && String(argumentsObject.created_at).trim()
        ? String(argumentsObject.created_at).trim()
        : new Date().toISOString();

    const date = validateCreatedAt(createdAt);
    const tags = normalizeTags(argumentsObject?.tags);

    ensureDirExists(targetDir);

    const timestampPart = buildTimestampPart(date);
    const safeTitle = sanitizeFileName(title) || 'untitled-chat';
    const fileName = buildUniqueFileName(targetDir, `${timestampPart}-${safeTitle}`);
    const fullPath = path.join(targetDir, fileName);

    const markdown = buildMarkdownDocument({
      title,
      body,
      source,
      createdAt,
      model,
      tags
    });

    fs.writeFileSync(fullPath, markdown, 'utf8');

    logToStderr('mcp-note-ingest', `ingest ok | source=${source} | path=${fullPath}`);

    return {
      content: [
        {
          type: 'text',
          text: [
            'ingest_chat_markdown ok',
            `title: ${title}`,
            `source: ${source}`,
            `full_path: ${fullPath}`
          ].join('\n')
        }
      ],
      structuredContent: {
        ok: true,
        title,
        source,
        file_name: fileName,
        full_path: fullPath,
        target_dir: targetDir,
        created_at: createdAt,
        tags,
        model
      }
    };
  };
}

module.exports = {
  schema,
  handler: createIngestChatMarkdownHandler(),
  createIngestChatMarkdownHandler,
  DEFAULT_TARGET_DIR
};
