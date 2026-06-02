const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const SCHEMA_VERSION = '1';
const EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_DIM = 768;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  project      TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER NOT NULL,
  turn_count   INTEGER NOT NULL,
  source_path  TEXT UNIQUE NOT NULL,
  source_mtime INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_started
  ON sessions(project, started_at);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_index  INTEGER NOT NULL,
  role        TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  text        TEXT NOT NULL,
  token_est   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text);
`;

function openStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${EMBEDDING_DIM}])`
  );

  const insertMetaStmt = db.prepare(
    'INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)'
  );
  insertMetaStmt.run('schema_version', SCHEMA_VERSION);
  insertMetaStmt.run('embedding_model', EMBEDDING_MODEL);
  insertMetaStmt.run('embedding_dim', String(EMBEDDING_DIM));

  const stmts = {
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare(
      'INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)'
    ),
    getSessionByPath: db.prepare('SELECT * FROM sessions WHERE source_path = ?'),
    getChunkIdsForSession: db.prepare(
      'SELECT chunk_id FROM chunks WHERE session_id = ?'
    ),
    deleteFtsByRowid: db.prepare('DELETE FROM chunks_fts WHERE rowid = ?'),
    deleteVecByRowid: db.prepare('DELETE FROM vec_chunks WHERE rowid = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE session_id = ?'),
    insertSession: db.prepare(`
      INSERT INTO sessions(session_id, project, started_at, ended_at, turn_count, source_path, source_mtime)
      VALUES (@session_id, @project, @started_at, @ended_at, @turn_count, @source_path, @source_mtime)
    `),
    insertChunk: db.prepare(`
      INSERT INTO chunks(session_id, turn_index, role, ts, text, token_est)
      VALUES (@session_id, @turn_index, @role, @ts, @text, @token_est)
    `),
    insertFts: db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?, ?)'),
    insertVec: db.prepare('INSERT INTO vec_chunks(rowid, embedding) VALUES (?, ?)')
  };

  function getMeta(key) {
    const r = stmts.getMeta.get(key);
    return r ? r.value : null;
  }

  function setMeta(key, value) {
    stmts.setMeta.run(key, value);
  }

  function getSessionByPath(p) {
    return stmts.getSessionByPath.get(p) || null;
  }

  function purgeSessionRefs(sessionId) {
    const rows = stmts.getChunkIdsForSession.all(sessionId);
    for (const r of rows) {
      stmts.deleteFtsByRowid.run(r.chunk_id);
      stmts.deleteVecByRowid.run(BigInt(r.chunk_id));
    }
    stmts.deleteSession.run(sessionId); // ON DELETE CASCADE clears chunks rows
  }

  const insertSessionTx = db.transaction((meta, chunks, embeddings) => {
    purgeSessionRefs(meta.session_id);
    stmts.insertSession.run(meta);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const r = stmts.insertChunk.run({
        session_id: meta.session_id,
        turn_index: c.turn_index,
        role: c.role,
        ts: c.ts,
        text: c.text,
        token_est: c.token_est
      });
      const chunkId = r.lastInsertRowid;
      stmts.insertFts.run(chunkId, c.text);
      if (embeddings && embeddings[i] instanceof Float32Array) {
        // sqlite-vec's vec0 requires rowid bound as BigInt; JS numbers bind
        // as REAL and the virtual table rejects them.
        stmts.insertVec.run(BigInt(chunkId), Buffer.from(embeddings[i].buffer));
      }
    }
  });

  function insertSession(meta, chunks, embeddings) {
    insertSessionTx(meta, chunks, embeddings);
  }

  function close() {
    db.close();
  }

  return {
    db,
    getMeta,
    setMeta,
    getSessionByPath,
    insertSession,
    close
  };
}

module.exports = { openStore, EMBEDDING_DIM, EMBEDDING_MODEL, SCHEMA_VERSION };
