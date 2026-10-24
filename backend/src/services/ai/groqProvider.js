const { buildPrompt, groqResponseJsonSchema } = require('./analysisContract');
const { AIProviderError, normalizeProviderError } = require('./providerUtils');

async function analyzeWithGroq(incident, {
  apiKey,
  baseUrl,
  model,
  timeoutMs,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new AIProviderError('groq', 'configuration');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        include_reasoning: false,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'incident_analysis',
            strict: true,
            schema: groqResponseJsonSchema,
          },
        },
        messages: [
          { role: 'system', content: 'Return only valid JSON. Rescue decisions always require human review.' },
          { role: 'user', content: buildPrompt(incident) },
        ],
      }),
    });
    if (!response.ok) {
      throw new AIProviderError('groq', response.status === 429 ? 'rate_limit'
        : response.status === 401 || response.status === 403 ? 'authentication'
          : response.status >= 500 ? 'server' : 'request', { status: response.status });
    }
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AIProviderError('groq', 'invalid_response');
    }
    return content;
  } catch (error) {
    throw normalizeProviderError('groq', error);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { analyzeWithGroq };
