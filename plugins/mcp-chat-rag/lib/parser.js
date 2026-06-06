const { logToStderr } = require('./logger');

const NOISE_TYPES = new Set([
  'queue-operation',
  'permission-mode',
  'file-history-snapshot',
  'attachment',
  'ai-title',
  'system',
  'last-prompt'
]);

const TOOL_USE_SUMMARY_MAX = 220;

function summarizeToolUse(block) {
  const name = block.name || 'unknown';
  const input = block.input || {};
  const firstKey = Object.keys(input)[0];
  const prefix = `tool_use: ${name}`;
  if (firstKey === undefined) return prefix;

  const raw = JSON.stringify(input[firstKey]);
  if (typeof raw !== 'string') return prefix;

  const fieldHeader = ` input.${firstKey}=`;
  const budget = TOOL_USE_SUMMARY_MAX - prefix.length - fieldHeader.length;
  if (budget <= 0) return prefix;

  const value = raw.length > budget ? raw.slice(0, budget - 1) + '…' : raw;
  return `${prefix}${fieldHeader}${value}`;
}

function metaFrom(obj) {
  return {
    session_id: obj.sessionId || null,
    parent_uuid: obj.parentUuid === undefined ? null : obj.parentUuid,
    uuid: obj.uuid || null,
    ts: obj.timestamp || null,
    cwd: obj.cwd || null,
    git_branch: obj.gitBranch || null
  };
}

function parseLine(rawLine, lineNo) {
  let obj;
  try {
    obj = JSON.parse(rawLine);
  } catch (err) {
    logToStderr('mcp-chat-rag', `parser: malformed JSON at line ${lineNo}: ${err.message}`);
    return null;
  }

  if (!obj || typeof obj !== 'object') return null;
  if (NOISE_TYPES.has(obj.type)) return null;
  if (obj.type !== 'user' && obj.type !== 'assistant') return null;

  const meta = metaFrom(obj);
  const role = obj.type;
  const content = obj.message && obj.message.content;

  if (typeof content === 'string') {
    if (content.length === 0) return [];
    return [{
      ...meta,
      role,
      kind: role === 'user' ? 'user_text' : 'assistant_text',
      text: content
    }];
  }

  if (!Array.isArray(content)) return [];

  const turns = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;

    if (block.type === 'thinking') continue;
    if (block.type === 'tool_result') continue;

    if (block.type === 'text') {
      const text = typeof block.text === 'string' ? block.text : '';
      if (text.length === 0) continue;
      turns.push({
        ...meta,
        role,
        kind: role === 'user' ? 'user_text' : 'assistant_text',
        text
      });
      continue;
    }

    if (block.type === 'tool_use') {
      turns.push({
        ...meta,
        role,
        kind: 'tool_use_summary',
        text: summarizeToolUse(block)
      });
      continue;
    }
  }

  return turns;
}

module.exports = { parseLine };
