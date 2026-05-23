const {
  validateReadSideVault,
  listMarkdownFiles
} = require('../vault-fs');

const schema = {
  name: 'list_notes',
  description: 'List Markdown notes in the vault.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['vault_path'],
    properties: {
      vault_path: {
        type: 'string',
        description: 'Absolute path to the vault root folder.'
      },
      subdir: {
        type: 'string',
        description: 'Optional vault-relative subdirectory to limit the listing to.'
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'Optional cap on the number of notes returned.'
      },
      since: {
        type: 'integer',
        description: 'Optional epoch-ms cutoff; only notes with mtime > since are returned.'
      }
    }
  }
};

function handler(args) {
  const root = validateReadSideVault(args && args.vault_path);
  const notes = listMarkdownFiles(root, {
    subdir: args ? args.subdir : undefined,
    limit: args ? args.limit : undefined,
    since: args ? args.since : undefined
  });
  return {
    content: [{ type: 'text', text: `${notes.length} notes` }],
    structuredContent: { notes }
  };
}

module.exports = { schema, handler };
