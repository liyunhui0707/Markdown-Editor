const fs = require('fs');
const path = require('path');
const { parseLine } = require('./parser');
const { chunkTurn } = require('./chunker');
const { redact } = require('./redactor');
const { logToStderr } = require('./logger');

function isoToUnix(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function readdirSafe(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true });
  } catch (err) {
    return [];
  }
}

function* listSessionFiles(root) {
  for (const projEntry of readdirSafe(root)) {
    if (!projEntry.isDirectory()) continue;
    const projPath = path.join(root, projEntry.name);
    for (const f of readdirSafe(projPath)) {
      if (!f.isFile()) continue; // symlinks return false here
      if (!f.name.endsWith('.jsonl')) continue;
      yield path.join(projPath, f.name);
    }
  }
}

function parseSessionFile(filePath, log) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const turns = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parsed = parseLine(line, i + 1);
    if (parsed === null) continue;
    for (const t of parsed) turns.push(t);
  }
  return turns;
}

function buildSessionMeta(turns, filePath, mtime) {
  const first = turns[0];
  // Use the earliest/latest VALID timestamp across all turns, not turns[0] and
  // turns[-1]. JSONL is usually chronological, but out-of-order or missing
  // timestamps would otherwise skew list_recent_sessions ordering (isoToUnix
  // returns 0 for invalid, which we treat as "no timestamp" here).
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const t of turns) {
    const u = isoToUnix(t.ts);
    if (u > 0) {
      if (u < minTs) minTs = u;
      if (u > maxTs) maxTs = u;
    }
  }
  const startedAt = minTs === Infinity ? 0 : minTs;
  const endedAt = maxTs === -Infinity ? startedAt : maxTs;
  return {
    session_id: first.session_id || path.basename(filePath, '.jsonl'),
    project: first.cwd || 'unknown',
    started_at: startedAt,
    ended_at: endedAt,
    turn_count: turns.length,
    source_path: filePath,
    source_mtime: Math.floor(mtime)
  };
}

async function indexOneFile({ store, embedder, filePath, log }) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    log(`stat failed: ${filePath}: ${err.message}`);
    return { indexed: false, skipped: false, error: true };
  }
  const mtime = Math.floor(stat.mtimeMs / 1000);

  const existing = store.getSessionByPath(filePath);
  if (existing && existing.source_mtime === mtime) {
    // mtime-unchanged path: still check whether a prior pass left embeddings
    // missing (Ollama was down). Back-fill if the embedder is now available.
    if (embedder && embedder.isAvailable) {
      const missing = store.getChunksMissingEmbeddings(existing.session_id);
      if (missing.length > 0) {
        try {
          const vecs = await embedder.embedBatch(missing.map(m => m.text));
          const pairs = missing.map((m, i) => ({ chunk_id: m.chunk_id, embedding: vecs[i] }));
          store.backfillEmbeddings(pairs);
          return { indexed: false, skipped: false, backfilled: missing.length };
        } catch (err) {
          log(`backfill failed for ${filePath}: ${err.message}`);
        }
      }
    }
    return { indexed: false, skipped: true };
  }

  const turns = parseSessionFile(filePath, log);
  if (turns.length === 0) {
    // mtime changed but the file now yields nothing: drop any prior index of it
    // so stale (possibly now-removed) content is not still searchable.
    if (existing) {
      store.purgeSessionByPath(filePath);
      return { indexed: false, skipped: false, purged: true };
    }
    return { indexed: false, skipped: false };
  }

  // Build chunks with turn-index numbering across this session's turns.
  const allChunks = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = { ...turns[i], turn_index: i };
    const subs = chunkTurn(turn);
    for (const c of subs) {
      const r = redact(c.text);
      if (r.shouldDrop) continue;
      allChunks.push({
        session_id: c.session_id,
        turn_index: c.turn_index,
        role: c.role,
        ts: isoToUnix(c.ts),
        text: r.text,
        token_est: Math.ceil(r.text.length / 4)
      });
    }
  }

  if (allChunks.length === 0) {
    // Every chunk was redacted away. If we'd indexed this file before, purge it
    // so the now-fully-redacted content stops being retrievable.
    if (existing) {
      store.purgeSessionByPath(filePath);
      return { indexed: false, skipped: false, purged: true };
    }
    return { indexed: false, skipped: false };
  }

  let embeddings = null;
  if (embedder && embedder.isAvailable) {
    try {
      embeddings = await embedder.embedBatch(allChunks.map(c => c.text));
    } catch (err) {
      log(`embedder failed for ${filePath}: ${err.message}`);
      embeddings = null;
    }
  }

  const meta = buildSessionMeta(turns, filePath, mtime);
  store.insertSession(meta, allChunks, embeddings);
  return { indexed: true, skipped: false };
}

async function indexAll({ store, embedder, root, log }) {
  const logger = log || ((msg) => logToStderr('mcp-chat-rag', `indexer: ${msg}`));
  const stats = {
    sessions_indexed: 0,
    sessions_skipped: 0,
    sessions_backfilled: 0,
    sessions_purged: 0,
    sessions_empty: 0,
    errors: 0
  };
  for (const filePath of listSessionFiles(root)) {
    try {
      const r = await indexOneFile({ store, embedder, filePath, log: logger });
      if (r.indexed) stats.sessions_indexed++;
      else if (r.backfilled) stats.sessions_backfilled++;
      else if (r.purged) stats.sessions_purged++;
      else if (r.skipped) stats.sessions_skipped++;
      else if (r.error) stats.errors++;
      else stats.sessions_empty++;
    } catch (err) {
      logger(`indexOneFile threw for ${filePath}: ${err.stack || err.message}`);
      stats.errors++;
    }
  }
  return stats;
}

module.exports = { indexAll };
