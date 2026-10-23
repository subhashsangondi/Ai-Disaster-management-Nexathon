import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { analyzeIncident } = require('../src/services/aiService');

const incident = {
  emergency_type: 'landslide',
  description: 'Three people trapped under debris. One person unconscious.',
  latitude: 12.9141,
  longitude: 74.856,
  location_text: 'Demo village bridge',
};

describe('Gemini incident analysis adapter', () => {
  it('validates and returns structured output', async () => {
    const output = {
      disaster_type: 'landslide',
      urgency: 'critical',
      victim_count: 3,
      summary: 'Three people are reportedly trapped.',
      reasoning: 'The report explicitly mentions trapped and unconscious people.',
      requires_review: true,
    };
    const client = {
      models: { generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(output) }) },
    };
    await expect(analyzeIncident(incident, { client, timeoutMs: 100 })).resolves.toEqual(output);
  });

  it('returns a controlled 503 when Gemini fails', async () => {
    const client = {
      models: { generateContent: vi.fn().mockRejectedValue(new Error('network failure')) },
    };
    await expect(analyzeIncident(incident, { client, timeoutMs: 100 })).rejects.toMatchObject({
      statusCode: 503,
      message: 'AI analysis service is temporarily unavailable',
    });
  });

  it('rejects invalid AI JSON and invalid structured output', async () => {
    const badJsonClient = {
      models: { generateContent: vi.fn().mockResolvedValue({ text: '{bad-json' }) },
    };
    await expect(analyzeIncident(incident, { client: badJsonClient })).rejects.toMatchObject({
      statusCode: 503,
      message: 'AI analysis returned an invalid response',
    });

    const inventedShapeClient = {
      models: { generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({ urgency: 'urgent' }) }) },
    };
    await expect(analyzeIncident(incident, { client: inventedShapeClient })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('removes an AI-invented victim count and always requires human review', async () => {
    const client = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            disaster_type: 'flood',
            urgency: 'high',
            victim_count: 8,
            summary: 'Water is entering a building.',
            reasoning: 'The water level may present a risk.',
            requires_review: false,
          }),
        }),
      },
    };
    const result = await analyzeIncident({
      emergency_type: 'flood',
      description: 'Water is entering the lower floor of a building.',
      latitude: null,
      longitude: null,
      location_text: 'Demo site',
    }, { client });

    expect(result.victim_count).toBeNull();
    expect(result.requires_review).toBe(true);
  });
});
