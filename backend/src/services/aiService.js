const env = require('../config/env');
const { AppError } = require('../utils/apiResponse');
const {
  analysisSchema,
  hasExplicitVictimCount,
  validateAnalysis,
} = require('./ai/analysisContract');
const { analyzeWithGemini } = require('./ai/geminiProvider');
const { analyzeWithGroq } = require('./ai/groqProvider');
const {
  AIProviderError,
  normalizeProviderError,
  safeLogFailure,
} = require('./ai/providerUtils');

async function analyzeIncident(incident, options = {}) {
  const logger = options.logger || console;
  const geminiModel = options.geminiModel || env.GEMINI_MODEL;
  const groqModel = options.groqModel || env.GROQ_MODEL;
  const providers = [
    {
      name: 'gemini',
      model: geminiModel,
      run: options.geminiProvider || (() => analyzeWithGemini(incident, {
        apiKey: options.geminiApiKey ?? options.apiKey ?? env.GEMINI_API_KEY,
        model: geminiModel,
        timeoutMs: options.geminiTimeoutMs || options.timeoutMs || env.GEMINI_TIMEOUT_MS,
        client: options.geminiClient || options.client,
      })),
    },
    {
      name: 'groq',
      model: groqModel,
      run: options.groqProvider || (() => analyzeWithGroq(incident, {
        apiKey: options.groqApiKey ?? env.GROQ_API_KEY,
        baseUrl: options.groqBaseUrl || env.GROQ_API_BASE_URL,
        model: groqModel,
        timeoutMs: options.groqTimeoutMs || env.GROQ_TIMEOUT_MS,
        fetchImpl: options.fetchImpl,
      })),
    },
  ];

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    try {
      const content = await provider.run();
      let analysis;
      try {
        analysis = validateAnalysis(content, incident);
      } catch (error) {
        throw new AIProviderError(provider.name, 'invalid_response', { cause: error });
      }
      return {
        analysis,
        provider_metadata: {
          provider: provider.name,
          model: provider.model,
          fallback_used: index > 0,
        },
      };
    } catch (error) {
      safeLogFailure(logger, normalizeProviderError(provider.name, error));
    }
  }

  throw new AppError(
    503,
    'AI analysis is unavailable; manual operator review is required',
    undefined,
    'AI_PROVIDERS_UNAVAILABLE',
  );
}

module.exports = {
  analyzeIncident,
  analysisSchema,
  hasExplicitVictimCount,
};
