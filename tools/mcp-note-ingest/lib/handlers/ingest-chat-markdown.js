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
} = require('../core');
const { logToStderr } = require('../logger');

const schema = {
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

function handler(argumentsObject) {
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

  logToStderr('mcp-note-ingest', `ingest ok | source=${source} | path=${relativePath}`);

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

module.exports = { schema, handler };
