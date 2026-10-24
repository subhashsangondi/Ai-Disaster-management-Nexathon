class AIProviderError extends Error {
  constructor(provider, category, { status = null, cause } = {}) {
    super(`${provider} provider failed`);
    this.name = 'AIProviderError';
    this.provider = provider;
    this.category = category;
    this.status = status;
    this.cause = cause;
  }
}

function classifyProviderError(error) {
  if (error instanceof AIProviderError) return error.category;
  if (error?.name === 'AbortError' || /timed out|timeout/i.test(error?.message || '')) return 'timeout';
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  if (status === 401 || status === 403) return 'authentication';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (error instanceof SyntaxError || /invalid structured|no structured/i.test(error?.message || '')) return 'invalid_response';
  if (error instanceof TypeError || error?.code) return 'network';
  return 'unknown';
}

function normalizeProviderError(provider, error) {
  if (error instanceof AIProviderError) return error;
  return new AIProviderError(provider, classifyProviderError(error), {
    status: Number(error?.status || error?.statusCode || error?.response?.status) || null,
    cause: error,
  });
}

async function withTimeout(operation, timeoutMs, provider) {
  let timeout;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new AIProviderError(provider, 'timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function safeLogFailure(logger, error) {
  const write = logger?.warn || logger?.error;
  if (typeof write !== 'function') return;
  write.call(logger, 'AI provider attempt failed', {
    provider: error.provider,
    category: error.category,
    status: error.status,
  });
}

module.exports = {
  AIProviderError,
  classifyProviderError,
  normalizeProviderError,
  withTimeout,
  safeLogFailure,
};
