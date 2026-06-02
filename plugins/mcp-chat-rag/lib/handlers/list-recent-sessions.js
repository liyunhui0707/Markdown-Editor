const schema = {
  name: 'list_recent_sessions',
  description: 'List the most recent indexed sessions for the current project (or all projects).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project: { type: 'string' },
      cross_project: { type: 'boolean' },
      limit: { type: 'integer' }
    }
  }
};

function createHandler(ctx) {
  return async function (args) {
    const a = args || {};
    const limit = Math.min(Math.max(a.limit || 20, 1), 100);
    const project = a.project || ctx.defaultProject;
    const crossProject = !!a.cross_project;

    let sql = 'SELECT * FROM sessions';
    const params = [];
    if (!crossProject && project) {
      sql += ' WHERE project = ?';
      params.push(project);
    }
    sql += ' ORDER BY started_at DESC LIMIT ?';
    params.push(limit);

    const sessions = ctx.store.db.prepare(sql).all(...params);
    const previewStmt = ctx.store.db.prepare(`
      SELECT text FROM chunks
      WHERE session_id = ? AND role = 'user'
      ORDER BY chunk_id
      LIMIT 1
    `);

    return {
      sessions: sessions.map(s => {
        const firstUser = previewStmt.get(s.session_id);
        const preview = firstUser ? firstUser.text.slice(0, 200) : '';
        return {
          session_id: s.session_id,
          project: s.project,
          started_at: new Date(s.started_at * 1000).toISOString(),
          turn_count: s.turn_count,
          first_user_turn_preview: preview
        };
      })
    };
  };
}

module.exports = { schema, createHandler };
