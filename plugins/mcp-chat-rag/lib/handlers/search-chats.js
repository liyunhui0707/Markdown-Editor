const { ToolError } = require('../tool-error');
const { search } = require('../retrieval');

const schema = {
  name: 'search_chats',
  description:
    'Search past Claude Code session chunks via BM25 + sqlite-vec hybrid retrieval. ' +
    'Returns up to k chunks with stable citations.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Natural-language query (required).' },
      project: { type: 'string', description: 'Restrict to a project path; defaults to the server\'s default project.' },
      cross_project: { type: 'boolean', description: 'When true, search across all indexed projects.' },
      date_from: { type: 'string', description: 'ISO date (inclusive lower bound).' },
      date_to: { type: 'string', description: 'ISO date (inclusive upper bound).' },
      k: { type: 'integer', description: 'Max results (default 8, max 50).' }
    },
    required: ['query']
  }
};

function isoToUnix(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

function createHandler(ctx) {
  return async function (args) {
    const a = args || {};
    if (typeof a.query !== 'string' || a.query.length === 0) {
      throw new ToolError('EMPTY_QUERY', 'query must be a non-empty string');
    }
    const k = Math.min(Math.max(a.k || 8, 1), 50);
    const result = await search({
      store: ctx.store,
      embedder: ctx.embedder,
      query: a.query,
      project: a.project || ctx.defaultProject,
      crossProject: !!a.cross_project,
      dateFrom: a.date_from ? isoToUnix(a.date_from) : undefined,
      dateTo: a.date_to ? isoToUnix(a.date_to) : undefined,
      k
    });
    if (ctx.isIndexing && ctx.isIndexing() && result.results.length === 0) {
      result.warnings.push('indexing_in_progress');
    }
    return result;
  };
}

module.exports = { schema, createHandler };
