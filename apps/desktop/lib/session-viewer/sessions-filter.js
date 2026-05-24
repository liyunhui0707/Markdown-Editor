// Stage S2 — path matcher for the AI Sessions filter.
// The filter narrows the existing note list to files written by the
// S1 session importers, which land under
//   <vault>/Inbox/AI Chats/claude-code/<project>/<uuid>.md
//   <vault>/Inbox/AI Chats/codex/<YYYY>/<MM>/<DD>/<rollout>.md
// Distinct from the existing AI Imports filter (which also matches
// MCP-ingested notes by frontmatter `source:` or legacy
// Inbox/AI Chats/YYYY/MM/ paths).

'use strict';

const PREFIX_CLAUDE = 'Inbox/AI Chats/claude-code/';
const PREFIX_CODEX = 'Inbox/AI Chats/codex/';

function isSessionsImport(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return false;
  }
  if (relativePath.indexOf('\\') !== -1) return false;
  const trimmed = relativePath.charCodeAt(0) === 47 /* '/' */
    ? relativePath.slice(1)
    : relativePath;
  if (!trimmed.startsWith(PREFIX_CLAUDE) && !trimmed.startsWith(PREFIX_CODEX)) {
    return false;
  }
  // Require at least one character of file path beyond the prefix.
  const prefix = trimmed.startsWith(PREFIX_CLAUDE) ? PREFIX_CLAUDE : PREFIX_CODEX;
  return trimmed.length > prefix.length && !trimmed.endsWith('/');
}

module.exports = { isSessionsImport };
