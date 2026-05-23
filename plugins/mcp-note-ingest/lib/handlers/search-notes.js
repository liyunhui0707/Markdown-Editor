const { validateReadSideVault } = require('../vault-fs');
const { search } = require('../search');

const schema = {
  name: 'search_notes',
  description: 'Search the vault by substring across note titles, tags, source, and body.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['vault_path', 'query'],
    properties: {
      vault_path: {
        type: 'string',
        description: 'Absolute path to the vault root folder.'
      },
      query: {
        type: 'string',
        description: 'Substring to search for; case-insensitive; treated literally (no regex).'
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'Optional cap on number of hits returned. Default 50, max 200.'
      }
    }
  }
};

function handler(args) {
  const root = validateReadSideVault(args && args.vault_path);
  const result = search(root, args && args.query, { limit: args ? args.limit : undefined });
  return {
    content: [{ type: 'text', text: `${result.hits.length} hits` }],
    structuredContent: result
  };
}

module.exports = { schema, handler };
