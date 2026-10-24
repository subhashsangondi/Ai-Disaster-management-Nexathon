const { GoogleGenAI } = require('@google/genai');
const { buildPrompt, responseJsonSchema } = require('./analysisContract');
const { AIProviderError, normalizeProviderError, withTimeout } = require('./providerUtils');

async function analyzeWithGemini(incident, { apiKey, model, timeoutMs, client } = {}) {
  if (!apiKey && !client) throw new AIProviderError('gemini', 'configuration');
  const gemini = client || new GoogleGenAI({ apiKey });
  try {
    const response = await withTimeout(
      () => gemini.models.generateContent({
        model,
        contents: buildPrompt(incident),
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema,
          temperature: 0.1,
        },
      }),
      timeoutMs,
      'gemini',
    );
    return typeof response.text === 'function' ? await response.text() : response.text;
  } catch (error) {
    throw normalizeProviderError('gemini', error);
  }
}

module.exports = { analyzeWithGemini };
