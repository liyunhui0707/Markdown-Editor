const fs = require('fs');
const {
  validateReadSideVault,
  resolveRelativePath,
  toPosix
} = require('../vault-fs');
const { parseFrontmatter } = require('../frontmatter');
const { sha256OfBuffer } = require('../file-io');
const { ToolError } = require('../tool-error');

const schema = {
  name: 'read_note',
  description: 'Read a Markdown note from the vault as raw text plus parsed frontmatter.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['vault_path', 'relative_path'],
    properties: {
      vault_path: {
        type: 'string',
        description: 'Absolute path to the vault root folder.'
      },
      relative_path: {
        type: 'string',
        description: 'Vault-relative path to a .md file.'
      }
    }
  }
};

function handler(args) {
  const root = validateReadSideVault(args && args.vault_path);
  const relPathRaw = args && args.relative_path;
  if (typeof relPathRaw !== 'string' || relPathRaw === '') {
    throw new ToolError('INVALID_PATH', 'relative_path is required');
  }
  if (!relPathRaw.endsWith('.md')) {
    throw new ToolError('INVALID_PATH', 'not a markdown file');
  }
  const abs = resolveRelativePath(root, relPathRaw);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new ToolError('NOT_FOUND', 'note does not exist');
  }
  if (!stat.isFile()) {
    throw new ToolError('INVALID_PATH', 'not a file');
  }
  const rawBuf = fs.readFileSync(abs);
  const raw = rawBuf.toString('utf8');
  const { frontmatter, body, warnings } = parseFrontmatter(raw);
  return {
    content: [{ type: 'text', text: raw }],
    structuredContent: {
      relative_path: toPosix(relPathRaw),
      body,
      frontmatter,
      warnings: warnings || [],
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
      sha256: sha256OfBuffer(rawBuf)
    }
  };
}

module.exports = { schema, handler };
