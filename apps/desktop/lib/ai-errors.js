/* lib/ai-errors.js
   Typed error factory and canned user-facing messages for the AI feature.
   See plan G4 + H3: the IPC handler returns ONLY REASON_MESSAGES[reason]
   (plus an allow-listed ' (HTTP <int>)' suffix for http-error). Adapters
   throw via aiError(reason, message[, extras]); the IPC handler reads
   err.reason and err.status only — never err.message, never err.stack.
*/

'use strict';

const REASON_MESSAGES = Object.freeze({
  'empty-input':       'Open and select a note with content before summarizing.',
  'input-too-large':   'This note is too large to summarize. Try selecting part of it.',
  'server-unreachable':'Local AI server is not reachable. Start it or update AI settings.',
  'timeout':           'Summarize timed out. Try again or use a smaller model.',
  'http-error':        'Local AI server responded with an error.',
  'invalid-response':  'Local AI server returned an unexpected response.',
  'provider-error':    'AI provider is not available.',
  'unknown':           'Could not complete summarize. Please try again.',
});

const KNOWN_REASONS = Object.freeze(Object.keys(REASON_MESSAGES));

class AiError extends Error {
  constructor(reason, message, extras) {
    super(message);
    this.name = 'AiError';
    this.reason = reason;
    if (extras && typeof extras === 'object') {
      if (Object.prototype.hasOwnProperty.call(extras, 'status')) {
        this.status = extras.status;
      }
    }
  }
}

function aiError(reason, message, extras) {
  return new AiError(reason, message, extras);
}

function isKnownReason(reason) {
  return typeof reason === 'string' && KNOWN_REASONS.indexOf(reason) >= 0;
}

module.exports = { aiError, AiError, REASON_MESSAGES, KNOWN_REASONS, isKnownReason };
