const path = require('path');
const { logToStderr } = require('./logger');

const RRF_K = 60;
const POOL_SIZE = 50;

function rrfCombine(rankedLists, getKey) {
  const scores = new Map();
  const items = new Map();
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const key = getKey(item);
      const inc = 1 / (RRF_K + rank);
      scores.set(key, (scores.get(key) || 0) + inc);
      if (!items.has(key)) items.set(key, item);
    }
  }
  const merged = Array.from(scores.entries())
    .map(([key, score]) => ({ item: items.get(key), score, key }))
    .sort((a, b) => b.score - a.score);
  // Re-attach the RRF score onto each item for downstream use
  return merged.map(m => ({ ...m.item, _rrf_score: m.score }));
}

function buildFilters({ project, crossProject, dateFrom, dateTo }) {
  const where = [];
  const params = [];
  if (!crossProject && project) {
    where.push('s.project = ?');
    params.push(project);
  }
  if (typeof dateFrom === 'number') {
    where.push('c.ts >= ?');
    params.push(dateFrom);
  }
  if (typeof dateTo === 'number') {
    where.push('c.ts <= ?');
    params.push(dateTo);
  }
  return { where: where.length ? where.join(' AND ') : null, params };
}

function bm25Rows(db, query, filters) {
  const { where, params } = filters;
  let sql = `
    SELECT
      c.chunk_id, c.session_id, c.turn_index, c.role, c.ts, c.text, c.token_est,
      s.project,
      bm25(chunks_fts) AS rank
    FROM chunks_fts
    JOIN chunks   c ON chunks_fts.rowid = c.chunk_id
    JOIN sessions s ON c.session_id    = s.session_id
    WHERE chunks_fts MATCH ?
  `;
  const allParams = [query];
  if (where) {
    sql += ` AND ${where}`;
    allParams.push(...params);
  }
  sql += ` ORDER BY rank LIMIT ${POOL_SIZE}`;
  try {
    return db.prepare(sql).all(...allParams);
  } catch (err) {
    // FTS5 raises on syntax errors / empty queries; treat as no BM25 hits.
    return [];
  }
}

function vecRows(db, embedding, filters) {
  const { where, params } = filters;
  let sql = `
    SELECT
      c.chunk_id, c.session_id, c.turn_index, c.role, c.ts, c.text, c.token_est,
      s.project, v.distance
    FROM vec_chunks v
    JOIN chunks   c ON v.rowid       = c.chunk_id
    JOIN sessions s ON c.session_id  = s.session_id
    WHERE v.embedding MATCH ? AND k = ${POOL_SIZE}
  `;
  const allParams = [Buffer.from(embedding.buffer)];
  if (where) {
    sql += ` AND ${where}`;
    allParams.push(...params);
  }
  sql += ` ORDER BY v.distance`;
  try {
    return db.prepare(sql).all(...allParams);
  } catch (err) {
    logToStderr('mcp-chat-rag', `retrieval: vec query failed: ${err.message}`);
    return [];
  }
}

function citationFor(row) {
  const projBase = row.project ? path.basename(row.project) || row.project : 'unknown';
  const date = new Date(row.ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
  return `${projBase}/${row.session_id}#${row.turn_index} (${date})`;
}

function toResult(row) {
  return {
    chunk_id: typeof row.chunk_id === 'bigint' ? Number(row.chunk_id) : row.chunk_id,
    session_id: row.session_id,
    project: row.project,
    ts: new Date(row.ts * 1000).toISOString(),
    role: row.role,
    text: row.text,
    score: row._rrf_score,
    citation: citationFor(row)
  };
}

async function search({
  store,
  embedder,
  query,
  project,
  crossProject = false,
  dateFrom,
  dateTo,
  k = 8
}) {
  const warnings = [];
  const totalChunks = store.db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c;
  if (totalChunks === 0) {
    warnings.push('index_empty');
    return { results: [], warnings };
  }

  const filters = buildFilters({ project, crossProject, dateFrom, dateTo });
  const bm25 = bm25Rows(store.db, query, filters);

  let vec = [];
  if (embedder && embedder.isAvailable) {
    try {
      const [embedding] = await embedder.embedBatch([query]);
      vec = vecRows(store.db, embedding, filters);
    } catch (err) {
      warnings.push('ollama_unavailable_bm25_only');
    }
  } else {
    warnings.push('ollama_unavailable_bm25_only');
  }

  const merged = rrfCombine([bm25, vec], r => r.chunk_id);
  const topK = merged.slice(0, k).map(toResult);

  return { results: topK, warnings };
}

module.exports = { search, rrfCombine };
