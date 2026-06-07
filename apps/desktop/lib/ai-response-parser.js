/* lib/ai-response-parser.js
   Pure parser for OpenAI-compatible chat-completion responses.
   Returns { summary } on success; throws aiError('invalid-response', …)
   on any bad shape (including empty content after trim).
*/

'use strict';

const { aiError, REASON_MESSAGES } = require('./ai-errors');

function invalid() {
  return aiError('invalid-response', REASON_MESSAGES['invalid-response']);
}

function parseOpenAIChatResponse(json) {
  if (!json || typeof json !== 'object') throw invalid();
  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) throw invalid();
  const first = choices[0];
  if (!first || typeof first !== 'object') throw invalid();
  const msg = first.message;
  if (!msg || typeof msg !== 'object') throw invalid();
  const raw = msg.content;
  if (typeof raw !== 'string') throw invalid();
  const summary = raw.trim();
  if (summary.length === 0) throw invalid();
  return { summary };
}

module.exports = { parseOpenAIChatResponse };
