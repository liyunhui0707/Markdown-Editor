const userStringContent = {
  parentUuid: null,
  isSidechain: false,
  promptId: 'p-1',
  type: 'user',
  message: { role: 'user', content: 'how do we handle CRLF?' },
  uuid: 'u-1',
  timestamp: '2026-05-30T22:19:59.487Z',
  cwd: '/Users/x/proj',
  sessionId: 'sess-1',
  version: '2.1.149',
  gitBranch: 'main'
};

const assistantArrayBlocks = {
  parentUuid: 'u-1',
  isSidechain: false,
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'considering options', signature: 'sig' },
      { type: 'text', text: 'Use \\n explicitly.' },
      { type: 'tool_use', id: 'tu-1', name: 'Edit', input: { file_path: '/x/y.js', old_string: 'a', new_string: 'b' } }
    ]
  },
  uuid: 'u-2',
  timestamp: '2026-05-30T22:20:00.000Z',
  cwd: '/Users/x/proj',
  sessionId: 'sess-1',
  version: '2.1.149',
  gitBranch: 'main'
};

const noiseTypes = [
  { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-05-30T22:19:59.178Z', sessionId: 'sess-1', content: 'noise' },
  { type: 'permission-mode', permissionMode: 'default', sessionId: 'sess-1' },
  { type: 'file-history-snapshot', messageId: 'm', snapshot: {}, isSnapshotUpdate: false },
  { parentUuid: 'u-1', type: 'attachment', attachment: {}, uuid: 'a-1', timestamp: '2026-05-30T22:20:00.000Z', sessionId: 'sess-1' },
  { type: 'ai-title', aiTitle: 'session about CRLF', sessionId: 'sess-1' },
  { parentUuid: 'u-1', type: 'system', subtype: 'meta', durationMs: 0, messageCount: 0, timestamp: '2026-05-30T22:20:00.000Z', uuid: 's-1', isMeta: true, sessionId: 'sess-1' },
  { type: 'last-prompt', lastPrompt: 'foo', leafUuid: 'u-1', sessionId: 'sess-1' }
];

const oversizedToolUseInput = {
  parentUuid: 'u-2',
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tu-2', name: 'Bash', input: { command: 'echo ' + 'x'.repeat(500) } }
    ]
  },
  uuid: 'u-3',
  timestamp: '2026-05-30T22:20:01.000Z',
  cwd: '/Users/x/proj',
  sessionId: 'sess-1',
  version: '2.1.149',
  gitBranch: 'main'
};

const emptyTextBlock = {
  parentUuid: 'u-3',
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: '' }] },
  uuid: 'u-4',
  timestamp: '2026-05-30T22:20:02.000Z',
  cwd: '/Users/x/proj',
  sessionId: 'sess-1'
};

const malformedJson = '{"type":"user","message":{"role":"user","content":"unterminated';

function asLine(obj) {
  return JSON.stringify(obj);
}

module.exports = {
  userStringContent,
  assistantArrayBlocks,
  noiseTypes,
  oversizedToolUseInput,
  emptyTextBlock,
  malformedJson,
  asLine
};
