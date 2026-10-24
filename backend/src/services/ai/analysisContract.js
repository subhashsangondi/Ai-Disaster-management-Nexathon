const { z } = require('zod');

const analysisSchema = z.object({
  disaster_type: z.string().trim().min(1).max(100),
  urgency: z.enum(['critical', 'high', 'medium', 'low', 'unknown']),
  victim_count: z.number().int().nonnegative().nullable(),
  summary: z.string().trim().min(1).max(1000),
  reasoning: z.string().trim().min(1).max(2000),
  requires_review: z.boolean(),
}).strict();

const responseJsonSchema = {
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
    disaster_type: { type: 'string' },
    urgency: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'unknown'] },
    victim_count: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    summary: { type: 'string' },
    reasoning: { type: 'string' },
    requires_review: { type: 'boolean' },
  },
};

// Groq's strict Structured Outputs mode expects nullable scalar fields to use
// a JSON Schema type union. Keep the Gemini schema unchanged because the
// Google SDK accepts its existing anyOf representation.
const groqResponseJsonSchema = {
  ...responseJsonSchema,
  properties: {
    ...responseJsonSchema.properties,
    victim_count: { type: ['integer', 'null'], minimum: 0 },
  },
};

function buildPrompt(incident) {
  const location = incident.location_text || 'Not provided';
  const coordinates = incident.latitude != null && incident.longitude != null
    ? `${incident.latitude}, ${incident.longitude}`
    : 'Not provided';

  return `You are an advisory incident triage assistant for human rescue coordinators.
Return only one JSON object matching the requested schema.
Analyze only the facts in this report. Do not invent a victim count, location, or severity.
Use null for victim_count unless a count is explicitly stated.
Use urgency "unknown" when evidence is insufficient.
The analysis is advisory and requires human judgment.

Emergency type: ${incident.emergency_type}
Description: ${incident.description}
Location text: ${location}
Coordinates: ${coordinates}`;
}

function hasExplicitVictimCount(description, count) {
  if (count === null) return true;
  const words = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen', 'twenty',
  ];
  const forms = [String(count)];
  if (words[count]) forms.push(words[count]);
  const countPattern = forms.join('|');
  const peoplePattern = '(?:people|persons?|victims?|individuals?|residents?|workers?|children|adults?|patients?|occupants?)';
  const patterns = [
    new RegExp(`\\b(?:${countPattern})\\s+${peoplePattern}\\b`, 'i'),
    new RegExp(`\\b${peoplePattern}\\s*[:=-]?\\s*(?:${countPattern})\\b`, 'i'),
    new RegExp(`\\bfamily\\s+of\\s+(?:${countPattern})\\b`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(description));
}

function parseStructuredContent(content) {
  if (content && typeof content === 'object') return content;
  if (typeof content !== 'string') throw new Error('Provider returned no structured content');
  const trimmed = content.trim();
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;
  return JSON.parse(unfenced);
}

function validateAnalysis(content, incident) {
  const parsed = parseStructuredContent(content);
  const validated = analysisSchema.safeParse(parsed);
  if (!validated.success) throw new Error('Provider returned invalid structured analysis');
  return {
    ...validated.data,
    victim_count: hasExplicitVictimCount(incident.description, validated.data.victim_count)
      ? validated.data.victim_count
      : null,
    requires_review: true,
  };
}

module.exports = {
  analysisSchema,
  responseJsonSchema,
  groqResponseJsonSchema,
  buildPrompt,
  hasExplicitVictimCount,
  validateAnalysis,
};
