import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findPossibleDuplicates, haversineKm } = require('../src/services/duplicateService');

describe('duplicate detection', () => {
  it('uses geographic distance and text/category similarity to flag a candidate', async () => {
    const incident = {
      id: '30000000-0000-4000-8000-000000000001',
      emergency_type: 'landslide',
      description: 'People trapped under debris near bridge',
      latitude: 12.9141,
      longitude: 74.856,
      location_text: 'Demo village bridge',
      created_at: '2026-01-01T10:00:00.000Z',
    };
    const repository = {
      findDuplicateCandidates: async () => [{
        id: '30000000-0000-4000-8000-000000000002',
        emergency_type: 'landslide',
        description: 'People trapped by debris beside bridge',
        latitude: 12.915,
        longitude: 74.857,
        location_text: 'Demo village bridge',
        created_at: '2026-01-01T09:30:00.000Z',
      }],
    };

    const matches = await findPossibleDuplicates(incident, { repository, radiusKm: 10 });
    expect(matches).toHaveLength(1);
    expect(matches[0].similarity_score).toBeGreaterThanOrEqual(0.45);
    expect(matches[0].distance_km).toBeLessThan(1);
  });

  it('calculates Haversine distance in kilometers', () => {
    const distance = haversineKm(0, 0, 0, 1);
    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112);
  });
});
