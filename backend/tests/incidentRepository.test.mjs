import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = require('../src/config/database');
const incidentRepository = require('../src/repositories/incidentRepository');

const id = '30000000-0000-4000-8000-000000000001';
const report = {
  idempotency_key: id,
  reporter_id: null,
  emergency_type: 'flood',
  description: 'Water is entering the lower floor.',
  latitude: 12.5,
  longitude: 75.5,
  location_text: 'Oak Street',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('idempotent SOS persistence', () => {
  it('inserts the client UUID into the existing incident primary key', async () => {
    const inserted = {
      id,
      reporter_id: null,
      emergency_type: report.emergency_type,
      description: report.description,
      latitude: report.latitude,
      longitude: report.longitude,
      location_text: report.location_text,
      status: 'pending',
    };
    const query = vi.spyOn(db, 'query').mockResolvedValue({ rows: [inserted] });

    await expect(incidentRepository.createIncident(report)).resolves.toEqual(inserted);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (id) DO NOTHING');
    expect(query.mock.calls[0][1][0]).toBe(id);
  });

  it('returns the existing report for an identical retry', async () => {
    const existing = {
      id,
      reporter_id: null,
      emergency_type: report.emergency_type,
      description: report.description,
      latitude: report.latitude,
      longitude: report.longitude,
      location_text: report.location_text,
      status: 'pending',
    };
    const query = vi.spyOn(db, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [existing] });

    await expect(incidentRepository.createIncident(report)).resolves.toEqual(existing);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects reuse of an ID for a different report', async () => {
    const existing = {
      id,
      reporter_id: null,
      emergency_type: 'fire',
      description: report.description,
      latitude: report.latitude,
      longitude: report.longitude,
      location_text: report.location_text,
    };
    vi.spyOn(db, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [existing] });

    await expect(incidentRepository.createIncident(report)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Idempotency key was already used for a different SOS report',
    });
  });
});