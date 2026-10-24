const db = require('../src/config/database');
const env = require('../src/config/env');
const { analyzeIncident } = require('../src/services/aiService');
const { AIProviderError } = require('../src/services/ai/providerUtils');

function assert(condition, message) {
  if (!condition) throw new Error(`Verification failed: ${message}`);
}

async function main() {
  assert(env.GEMINI_API_KEY, 'GEMINI_API_KEY is not configured');
  assert(env.GROQ_API_KEY, 'GROQ_API_KEY is not configured');

  const incident = {
    emergency_type: 'flood',
    description: 'Fictional verification report: two people need help leaving a flooded training building.',
    latitude: 12.9716,
    longitude: 77.5946,
    location_text: 'Fictional RescueGrid AI verification site',
  };
  const before = await db.query('SELECT count(*)::int AS count FROM possible_duplicates');
  const primary = await analyzeIncident(incident, { geminiTimeoutMs: 30000 });
  assert(primary.provider_metadata.provider === 'gemini', 'the normal analysis did not use Gemini as primary');
  assert(primary.analysis.requires_review === true, 'Gemini analysis must require human review');

  const fallback = await analyzeIncident(incident, {
    geminiProvider: async () => { throw new AIProviderError('gemini', 'timeout'); },
  });
  assert(fallback.provider_metadata.provider === 'groq', 'simulated Gemini failure did not use Groq');
  assert(fallback.provider_metadata.fallback_used === true, 'fallback metadata was not recorded');
  assert(fallback.analysis.requires_review === true, 'Groq analysis must require human review');

  const after = await db.query('SELECT count(*)::int AS count FROM possible_duplicates');
  assert(after.rows[0].count === before.rows[0].count, 'direct provider verification created duplicate records');

  console.log(JSON.stringify({
    gemini: {
      provider: primary.provider_metadata.provider,
      model: primary.provider_metadata.model,
      disaster_type: primary.analysis.disaster_type,
      urgency: primary.analysis.urgency,
      requires_review: primary.analysis.requires_review,
    },
    groq_fallback: {
      provider: fallback.provider_metadata.provider,
      model: fallback.provider_metadata.model,
      fallback_used: fallback.provider_metadata.fallback_used,
      disaster_type: fallback.analysis.disaster_type,
      urgency: fallback.analysis.urgency,
      requires_review: fallback.analysis.requires_review,
    },
    duplicate_records_created: 0,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
