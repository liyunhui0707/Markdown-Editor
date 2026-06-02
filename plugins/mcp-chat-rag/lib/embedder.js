class OllamaUnreachableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'OllamaUnreachableError';
    if (cause) this.cause = cause;
  }
}

class OllamaHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'OllamaHttpError';
    this.status = status;
  }
}

class EmbeddingDimError extends Error {
  constructor(expected, got) {
    super(`embedding dim mismatch: expected ${expected}, got ${got}`);
    this.name = 'EmbeddingDimError';
    this.expected = expected;
    this.got = got;
  }
}

function isUnreachable(err) {
  const code = err && (err.code || (err.cause && err.cause.code));
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
  // Node fetch reports network failures as TypeError with a "fetch failed" message.
  if (err && err.name === 'TypeError' && /fetch failed/.test(err.message)) return true;
  return false;
}

function createEmbedder({
  baseUrl = 'http://localhost:11434',
  model = 'nomic-embed-text',
  expectedDim = 768
} = {}) {
  const endpoint = baseUrl.replace(/\/$/, '') + '/api/embeddings';

  async function embedOne(text) {
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text })
      });
    } catch (err) {
      if (isUnreachable(err)) throw new OllamaUnreachableError(`Ollama unreachable at ${baseUrl}`, err);
      throw err;
    }

    if (!res.ok) {
      throw new OllamaHttpError(`Ollama HTTP ${res.status}`, res.status);
    }

    const body = await res.json();
    const vec = body && body.embedding;
    if (!Array.isArray(vec)) {
      throw new OllamaHttpError('Ollama response missing embedding array', res.status);
    }
    if (vec.length !== expectedDim) {
      throw new EmbeddingDimError(expectedDim, vec.length);
    }
    return Float32Array.from(vec);
  }

  async function embedBatch(texts) {
    const out = new Array(texts.length);
    for (let i = 0; i < texts.length; i++) {
      out[i] = await embedOne(texts[i]);
    }
    return out;
  }

  return {
    embedBatch,
    isAvailable: true,
    baseUrl,
    model,
    expectedDim
  };
}

module.exports = {
  createEmbedder,
  OllamaUnreachableError,
  OllamaHttpError,
  EmbeddingDimError
};
