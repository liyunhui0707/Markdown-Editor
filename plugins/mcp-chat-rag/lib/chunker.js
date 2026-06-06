const SPLIT_MARKERS = ['\n## ', '\n### ', '\n```'];

function tokenEst(text) {
  return Math.ceil(text.length / 4);
}

function findLastMarker(text, marker, lo, hi) {
  let idx = -1;
  let from = lo;
  while (true) {
    const found = text.indexOf(marker, from);
    if (found === -1 || found >= hi) break;
    idx = found;
    from = found + 1;
  }
  return idx;
}

function makeChunk(turn, text, subIndex) {
  return {
    session_id: turn.session_id,
    turn_index: turn.turn_index,
    role: turn.role,
    ts: turn.ts,
    text,
    token_est: tokenEst(text),
    sub_index: subIndex
  };
}

function chunkTurn(turn, opts) {
  const hardMax = (opts && opts.hardMax) || 1000;
  const softTarget = (opts && opts.softTarget) || 400;
  const text = (turn && typeof turn.text === 'string') ? turn.text : '';

  if (text.length === 0) return [];

  if (tokenEst(text) <= hardMax) {
    return [makeChunk(turn, text, 0)];
  }

  const hardMaxChars = hardMax * 4;
  const softTargetChars = softTarget * 4;
  const chunks = [];
  let pos = 0;
  let subIndex = 0;

  while (pos < text.length) {
    if (text.length - pos <= hardMaxChars) {
      chunks.push(makeChunk(turn, text.slice(pos), subIndex++));
      break;
    }

    const lo = pos + softTargetChars;
    const hi = Math.min(pos + hardMaxChars, text.length);

    let splitPoint = -1;
    for (const marker of SPLIT_MARKERS) {
      splitPoint = findLastMarker(text, marker, lo, hi);
      if (splitPoint !== -1) break;
    }

    if (splitPoint === -1) {
      splitPoint = hi;
    } else {
      // Keep the leading \n with the previous chunk so the next chunk starts
      // cleanly with the heading or fence.
      splitPoint += 1;
    }

    chunks.push(makeChunk(turn, text.slice(pos, splitPoint), subIndex++));
    pos = splitPoint;
  }

  return chunks;
}

module.exports = { chunkTurn };
