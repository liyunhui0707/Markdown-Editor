const {
  validateReadSideVault,
  listMarkdownFiles
} = require('../vault-fs');

const schema = {
  name: 'get_vault_info',
  description: 'Return a summary of the Markdown vault: note count, total bytes, last modified.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['vault_path'],
    properties: {
      vault_path: {
        type: 'string',
        description: 'Absolute path to the vault root folder.'
      }
    }
  }
};

function handler(args) {
  const root = validateReadSideVault(args && args.vault_path);
  const notes = listMarkdownFiles(root);
  let totalBytes = 0;
  let lastModified = null;
  for (const note of notes) {
    totalBytes += note.size;
    if (lastModified === null || note.mtime > lastModified) {
      lastModified = note.mtime;
    }
  }
  return {
    content: [{ type: 'text', text: `${notes.length} notes, ${totalBytes} bytes` }],
    structuredContent: {
      vault_path: root,
      note_count: notes.length,
      total_bytes: totalBytes,
      last_modified: lastModified
    }
  };
}

module.exports = { schema, handler };
