const schema = {
  name: 'ping',
  description: 'Simple smoke-test tool that proves the MCP server is working.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message: {
        type: 'string',
        description: 'Optional message to echo back.'
      }
    }
  }
};

function handler(argumentsObject) {
  const message =
    argumentsObject && typeof argumentsObject.message === 'string'
      ? argumentsObject.message
      : 'pong';

  return {
    content: [
      {
        type: 'text',
        text: `ping ok: ${message}`
      }
    ]
  };
}

module.exports = { schema, handler };
