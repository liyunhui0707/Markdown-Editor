/* lib/ai-prompt-builder.js
   Pure prompt builder for the Summarize feature. OpenAI-compatible chat
   messages: a system message that names the task and a user message that
   carries the note text wrapped in explicit <note>…</note> delimiters
   (so triple-backticks inside the note don't break the prompt structure).
*/

'use strict';

const { aiError, REASON_MESSAGES } = require('./ai-errors');

const SYSTEM_PROMPT =
  'You summarize Markdown notes. Read the note delimited by <note> and ' +
  '</note>, then return a concise plain-text summary. Preserve key facts ' +
  'and headings where helpful. Do not invent content. Do not include the ' +
  'delimiter tags in your output.';

function buildSummaryPrompt(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw aiError('empty-input', REASON_MESSAGES['empty-input']);
  }
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: '<note>\n' + text + '\n</note>' },
    ],
  };
}

module.exports = { buildSummaryPrompt };
