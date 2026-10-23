
const { GoogleGenAI } = require('@google/genai');
const { z } = require('zod');
const env = require('../config/env');
const { AppError } = require('../utils/apiResponse');

const analysisSchema = z.object({
  disaster_type: z.string().trim().min(1).max(100),
  urgency: z.enum(['critical', 'high', 'medium', 'low', 'unknown']),
  victim_count: z.number().int().nonnegative().nullable(),
  summary: z.string().trim().min(1).max(1000),
  reasoning: z.string().trim().min(1).max(2000),
  requires_review: z.boolean(),
}).strict();

function buildPrompt(incident) {
  const location = incident.location_text || 'Not provided';

  const coordinates =
    incident.latitude != null && incident.longitude != null
      ? `${incident.latitude}, ${incident.longitude}`
      : 'Not provided';

  return `You are an advisory incident triage assistant for human rescue coordinators.
Analyze only the facts in this report. Do not invent a victim count, location, or severity.
Use null for victim_count unless a count is explicitly stated.
Use urgency "unknown" when evidence is insufficient.
The recommendation is advisory and requires human judgment.

Emergency type: ${incident.emergency_type}
Description: ${incident.description}
Location text: ${location}
Coordinates: ${coordinates}`;
}

function hasExplicitVictimCount(description, count) {
  if (count === null) return true;

  const words = [
    'zero', 'one', 'two', 'three', 'four', 'five',
    'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen',
    'fifteen', 'sixteen', 'seventeen', 'eighteen',
    'nineteen', 'twenty',
  ];

  const forms = [String(count)];

  if (words[count]) {
    forms.push(words[count]);
  }

  const countPattern = forms.join('|');

  const peoplePattern =
    '(?:people|persons?|victims?|individuals?|residents?|workers?|children|adults?|patients?|occupants?)';

  const patterns = [
    new RegExp(
      `\\b(?:${countPattern})\\s+${peoplePattern}\\b`,
      'i'
    ),
    new RegExp(
      `\\b${peoplePattern}\\s*[:=-]?\\s*(?:${countPattern})\\b`,
      'i'
    ),
    new RegExp(
      `\\bfamily\\s+of\\s+(?:${countPattern})\\b`,
      'i'
    ),
  ];

  return patterns.some((pattern) => pattern.test(description));
}

async function analyzeIncident(incident, options = {}) {
  const apiKey = options.apiKey || env.GEMINI_API_KEY;

  if (!apiKey && !options.client) {
    throw new AppError(
      503,
      'AI analysis service is not configured'
    );
  }

  const client =
    options.client || new GoogleGenAI({ apiKey });

  const timeoutMs =
    options.timeoutMs || env.GEMINI_TIMEOUT_MS;

  let response;
  let timeout;

  const startTime = performance.now();

  try {
    const request = client.models.generateContent({
      model: env.GEMINI_MODEL,

      contents: buildPrompt(incident),

      config: {
        responseMimeType: 'application/json',

        responseJsonSchema: {
          type: 'object',

          additionalProperties: false,

          required: [
            'disaster_type',
            'urgency',
            'victim_count',
            'summary',
            'reasoning',
            'requires_review',
          ],

          properties: {
            disaster_type: {
              type: 'string',
            },

            urgency: {
              type: 'string',
              enum: [
                'critical',
                'high',
                'medium',
                'low',
                'unknown',
              ],
            },

            victim_count: {
              anyOf: [
                {
                  type: 'integer',
                  minimum: 0,
                },
                {
                  type: 'null',
                },
              ],
            },

            summary: {
              type: 'string',
            },

            reasoning: {
              type: 'string',
            },

            requires_review: {
              type: 'boolean',
            },
          },
        },

        temperature: 0.1,
      },
    });

    response = await Promise.race([
      request,

      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Gemini request timed out'));
        }, timeoutMs);
      }),
    ]);

  } catch (error) {
    console.error('Gemini failed:', {
      name: error.name,
      status: error.status,
      message: error.message,
    });

    throw new AppError(
      503,
      'AI analysis service is temporarily unavailable'
    );

  } finally {
    const duration =
      (performance.now() - startTime) / 1000;

    console.log(
      `Gemini API duration: ${duration.toFixed(2)} seconds`
    );

    clearTimeout(timeout);
  }

  const rawText =
    typeof response.text === 'function'
      ? response.text()
      : response.text;

  let parsed;

  try {
    parsed = JSON.parse(rawText);
  } catch (_error) {
    throw new AppError(
      503,
      'AI analysis returned an invalid response'
    );
  }

  const validated = analysisSchema.safeParse(parsed);

  if (!validated.success) {
    throw new AppError(
      503,
      'AI analysis returned an invalid response'
    );
  }

  return {
    ...validated.data,

    victim_count: hasExplicitVictimCount(
      incident.description,
      validated.data.victim_count
    )
      ? validated.data.victim_count
      : null,

    requires_review: true,
  };
}

module.exports = {
  analyzeIncident,
  analysisSchema,
  hasExplicitVictimCount,
};
