/* lib/ai-provider.js
   Tiny selector that returns the right adapter for settings.provider.
   Unknown provider → throws aiError('provider-error'); the IPC handler
   catches and converts to a typed failure response.
*/

'use strict';

const { aiError, REASON_MESSAGES } = require('./ai-errors');
const { createOpenAiCompatibleProvider } = require('./ai-provider-openai');

function resolveProvider(settings, deps) {
  const providerName = settings && settings.provider;
  if (providerName === 'openai-compatible') {
    return createOpenAiCompatibleProvider(deps);
  }
  throw aiError('provider-error', REASON_MESSAGES['provider-error']);
}

module.exports = { resolveProvider };
