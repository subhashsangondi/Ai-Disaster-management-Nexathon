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
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [inserted] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    vi.spyOn(db.pool, 'connect').mockResolvedValue(client);

    await expect(incidentRepository.createIncident(report)).resolves.toEqual(inserted);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[1][0]).toContain('ON CONFLICT (id) DO NOTHING');
    expect(client.query.mock.calls[1][1][0]).toBe(id);
    expect(client.release).toHaveBeenCalledOnce();
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
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [existing] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    vi.spyOn(db.pool, 'connect').mockResolvedValue(client);

    await expect(incidentRepository.createIncident(report)).resolves.toEqual(existing);
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[2][0]).toContain('FOR UPDATE');
    expect(client.release).toHaveBeenCalledOnce();
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
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [existing] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    vi.spyOn(db.pool, 'connect').mockResolvedValue(client);

    await expect(incidentRepository.createIncident(report)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Idempotency key was already used for a different SOS report',
    });
    expect(client.query.mock.calls[3][0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});