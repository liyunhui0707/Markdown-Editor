/* lib/ai-rewrite-prompt-builder.js
   Pure prompt builder for the Rewrite feature (Stage A — non-streaming).
   OpenAI-compatible chat messages: a system message that names the task
   and a user message that carries the input text wrapped in explicit
   <text>…</text> delimiters (so triple-backticks inside don't break the
   prompt structure).

   Mirrors lib/ai-prompt-builder.js (v0.2.0 Summarize) shape verbatim —
   only the system prompt differs (rewrite-for-clarity vs. summarize).
*/

'use strict';

const { aiError, REASON_MESSAGES } = require('./ai-errors');

const SYSTEM_PROMPT =
  'You rewrite text for clarity and concision. Read the text delimited by ' +
  '<text> and </text>, then return ONLY the rewritten text — no preamble, ' +
  'no commentary, no delimiter tags in your output.';

function buildRewritePrompt(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw aiError('empty-input', REASON_MESSAGES['empty-input']);
  }
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: '<text>\n' + text + '\n</text>' },
    ],
  };
}

module.exports = { buildRewritePrompt };
