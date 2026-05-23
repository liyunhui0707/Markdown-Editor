class ToolError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }
}

function mapToolErrorToJsonRpc(err) {
  if (!(err instanceof ToolError)) {
    return null;
  }
  return {
    code: -32602,
    message: err.message,
    data: { code: err.code, ...(err.data || {}) }
  };
}

module.exports = { ToolError, mapToolErrorToJsonRpc };
