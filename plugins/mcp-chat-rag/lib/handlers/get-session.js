const { ToolError } = require('../tool-error');

const schema = {
  name: 'get_session',
  description: 'Fetch turns from one indexed session, optionally a window around a chunk_id.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      session_id: { type: 'string' },
      around_chunk_id: { type: 'integer' },
      window: { type: 'integer', description: 'Number of turns to either side of around_chunk_id (default 6).' }
    },
    required: ['session_id']
  }
};

function createHandler(ctx) {
  return async function (args) {
    const a = args || {};
    if (typeof a.session_id !== 'string' || !a.session_id) {
      throw new ToolError('MISSING_SESSION_ID', 'session_id is required');
    }
    const session = ctx.store.db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(a.session_id);
    if (!session) {
      throw new ToolError('UNKNOWN_SESSION', `no such session: ${a.session_id}`);
    }

    const window = Math.min(Math.max(a.window || 6, 1), 50);
    let rows;
    if (a.around_chunk_id !== undefined && a.around_chunk_id !== null) {
      const target = ctx.store.db
        .prepare('SELECT turn_index FROM chunks WHERE chunk_id = ? AND session_id = ?')
        .get(a.around_chunk_id, a.session_id);
      if (!target) {
        rows = [];
      } else {
        rows = ctx.store.db.prepare(`
          SELECT chunk_id, turn_index, role, ts, text
          FROM chunks
          WHERE session_id = ?
            AND turn_index BETWEEN ? AND ?
          ORDER BY chunk_id
        `).all(a.session_id, target.turn_index - window, target.turn_index + window);
      }
    } else {
      rows = ctx.store.db.prepare(`
        SELECT chunk_id, turn_index, role, ts, text
        FROM chunks
        WHERE session_id = ?
        ORDER BY chunk_id
        LIMIT ?
      `).all(a.session_id, window * 2 + 1);
    }

    const structuredContent = {
      session_id: a.session_id,
      project: session.project,
      started_at: new Date(session.started_at * 1000).toISOString(),
      turns: rows.map(r => ({
        chunk_id: typeof r.chunk_id === 'bigint' ? Number(r.chunk_id) : r.chunk_id,
        turn_index: r.turn_index,
        role: r.role,
        ts: new Date(r.ts * 1000).toISOString(),
        text: r.text
      }))
    };
    const summary = `Session ${a.session_id} in ${session.project}: returned ${structuredContent.turns.length} turn(s).`;
    return {
      content: [{ type: 'text', text: summary }],
      structuredContent
    };
  };
}

module.exports = { schema, createHandler };
