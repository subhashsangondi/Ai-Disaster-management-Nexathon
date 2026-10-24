import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { analyzeIncident } = require('../src/services/aiService');
const { AIProviderError } = require('../src/services/ai/providerUtils');

const incident = {
  emergency_type: 'landslide',
  description: 'Three people trapped under debris. One person unconscious.',
  latitude: 12.9141,
  longitude: 74.856,
  location_text: 'Demo village bridge',
};

const structured = {
  disaster_type: 'landslide',
  urgency: 'critical',
  victim_count: 3,
  summary: 'Three people are reportedly trapped.',
  reasoning: 'The report explicitly mentions trapped and unconscious people.',
  requires_review: true,
};

const silentLogger = { warn: vi.fn() };

describe('AI provider fallback orchestration', () => {
  it('uses Gemini first and does not call Groq after valid output', async () => {
    const geminiProvider = vi.fn().mockResolvedValue(JSON.stringify(structured));
    const groqProvider = vi.fn();
    const result = await analyzeIncident(incident, { geminiProvider, groqProvider, geminiModel: 'gemini-test-model', logger: silentLogger });
    expect(result.analysis).toEqual(structured);
    expect(result.provider_metadata).toEqual({ provider: 'gemini', model: 'gemini-test-model', fallback_used: false });
    expect(groqProvider).not.toHaveBeenCalled();
  });

  it('falls back to Groq after a real Gemini timeout boundary', async () => {
    const client = { models: { generateContent: vi.fn(() => new Promise(() => {})) } };
    const groqProvider = vi.fn().mockResolvedValue(JSON.stringify(structured));
    const result = await analyzeIncident(incident, {
      geminiClient: client,
      geminiTimeoutMs: 5,
      groqProvider,
      logger: silentLogger,
    });
    expect(result.provider_metadata).toMatchObject({ provider: 'groq', fallback_used: true });
    expect(groqProvider).toHaveBeenCalledOnce();
  });

  it('falls back to Groq after Gemini rate limiting', async () => {
    const client = { models: { generateContent: vi.fn().mockRejectedValue(Object.assign(new Error('limited'), { status: 429 })) } };
    const groqProvider = vi.fn().mockResolvedValue(JSON.stringify(structured));
    const result = await analyzeIncident(incident, { geminiClient: client, groqProvider, logger: silentLogger });
    expect(result.provider_metadata.provider).toBe('groq');
    expect(result.provider_metadata.fallback_used).toBe(true);
  });

  it('falls back to Groq after malformed Gemini output', async () => {
    const geminiProvider = vi.fn().mockResolvedValue('{bad-json');
    const groqProvider = vi.fn().mockResolvedValue(JSON.stringify(structured));
    const result = await analyzeIncident(incident, { geminiProvider, groqProvider, logger: silentLogger });
    expect(result.analysis.urgency).toBe('critical');
    expect(result.provider_metadata.provider).toBe('groq');
  });

  it('rejects invalid Groq output after Gemini fails', async () => {
    await expect(analyzeIncident(incident, {
      geminiProvider: vi.fn().mockRejectedValue(new AIProviderError('gemini', 'server', { status: 503 })),
      groqProvider: vi.fn().mockResolvedValue(JSON.stringify({ urgency: 'urgent' })),
      logger: silentLogger,
    })).rejects.toMatchObject({ statusCode: 503, code: 'AI_PROVIDERS_UNAVAILABLE' });
  });

  it('returns manual-review unavailability when both providers fail', async () => {
    await expect(analyzeIncident(incident, {
      geminiProvider: vi.fn().mockRejectedValue(new AIProviderError('gemini', 'network')),
      groqProvider: vi.fn().mockRejectedValue(new AIProviderError('groq', 'server', { status: 500 })),
      logger: silentLogger,
    })).rejects.toMatchObject({
      statusCode: 503,
      message: 'AI analysis is unavailable; manual operator review is required',
    });
  });

  it('does not call Groq HTTP when its API key is missing', async () => {
    const fetchImpl = vi.fn();
    await expect(analyzeIncident(incident, {
      geminiProvider: vi.fn().mockRejectedValue(new AIProviderError('gemini', 'configuration')),
      groqApiKey: '',
      fetchImpl,
      logger: silentLogger,
    })).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the Groq OpenAI-compatible endpoint and validates its content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(structured) } }] }),
    });
    const result = await analyzeIncident(incident, {
      geminiProvider: vi.fn().mockRejectedValue(new AIProviderError('gemini', 'server')),
      groqApiKey: 'test-groq-key',
      groqBaseUrl: 'https://api.groq.test/openai/v1/',
      groqModel: 'openai/gpt-oss-20b',
      fetchImpl,
      logger: silentLogger,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0];
    const requestBody = JSON.parse(request.body);
    expect(url).toBe('https://api.groq.test/openai/v1/chat/completions');
    expect(requestBody.model).toBe('openai/gpt-oss-20b');
    expect(requestBody.include_reasoning).toBe(false);
    expect(requestBody.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'incident_analysis', strict: true },
    });
    expect(result.provider_metadata).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-20b', fallback_used: true });
  });

  it('never exposes provider credentials in logs or final errors', async () => {
    const logger = { warn: vi.fn() };
    const secret = 'do-not-expose-this-secret';
    let failure;
    try {
      await analyzeIncident(incident, {
        geminiProvider: vi.fn().mockRejectedValue(new Error(secret)),
        groqApiKey: secret,
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
        logger,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure.message).not.toContain(secret);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secret);
  });

  it('removes an invented victim count and always requires human review', async () => {
    const result = await analyzeIncident({
      emergency_type: 'flood',
      description: 'Water is entering the lower floor of a building.',
      latitude: null,
      longitude: null,
      location_text: 'Demo site',
    }, {
      geminiProvider: vi.fn().mockResolvedValue(JSON.stringify({
        disaster_type: 'flood',
        urgency: 'high',
        victim_count: 8,
        summary: 'Water is entering a building.',
        reasoning: 'The water level may present a risk.',
        requires_review: false,
      })),
      groqProvider: vi.fn(),
      logger: silentLogger,
    });
    expect(result.analysis.victim_count).toBeNull();
    expect(result.analysis.requires_review).toBe(true);
  });
});
