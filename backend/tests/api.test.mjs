import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = require('../src/app');
const env = require('../src/config/env');
const incidentRepository = require('../src/repositories/incidentRepository');
const assignmentService = require('../src/services/assignmentService');
const { AppError } = require('../src/utils/apiResponse');

const incidentId = '30000000-0000-4000-8000-000000000001';
const teamId = '20000000-0000-4000-8000-000000000001';
const operatorId = '10000000-0000-4000-8000-000000000001';
const operatorToken = jwt.sign(
  { user_id: operatorId, role: 'operator' },
  env.JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' },
);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SOS reporting', () => {
  it('persists a valid unauthenticated SOS before returning 201', async () => {
    const create = vi.spyOn(incidentRepository, 'createIncident').mockResolvedValue({
      id: incidentId,
      status: 'pending',
    });

    const response = await request(app).post('/api/sos').send({
      emergency_type: 'landslide',
      description: 'Three people are trapped under debris.',
      latitude: 12.9141,
      longitude: 74.856,
      location_text: 'Near the demo village bridge',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({ incident_id: incidentId, status: 'pending' });
    expect(response.body.data.notice).toMatch(/not confirmation/i);
    expect(create).toHaveBeenCalledOnce();
  });

  it('returns the same incident ID when the same SOS idempotency key is submitted twice', async () => {
    const create = vi.spyOn(incidentRepository, 'createIncident').mockResolvedValue({
      id: incidentId,
      status: 'pending',
    });

    const body = {
      emergency_type: 'flood',
      description: 'Water is entering the lower floor.',
      location_text: 'Oak Street',
    };
    const firstResponse = await request(app)
      .post('/api/sos')
      .set('Idempotency-Key', incidentId)
      .send(body);
    const retryResponse = await request(app)
      .post('/api/sos')
      .set('Idempotency-Key', incidentId)
      .send(body);

    expect(firstResponse.status).toBe(201);
    expect(retryResponse.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: incidentId,
      emergency_type: 'flood',
    }));
    expect(create).toHaveBeenCalledTimes(2);
    expect(firstResponse.body.data.incident_id).toBe(incidentId);
    expect(retryResponse.body.data.incident_id).toBe(firstResponse.body.data.incident_id);
  });

  it('rejects a malformed SOS idempotency key', async () => {
    const response = await request(app)
      .post('/api/sos')
      .set('Idempotency-Key', 'not-a-uuid')
      .send({
        emergency_type: 'flood',
        description: 'Water is entering the lower floor.',
        location_text: 'Oak Street',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  it('rejects a request without coordinates or location text', async () => {
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'flood',
      description: 'Water is entering the lower floor.',
    });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errors[0].field).toBe('location_text');
  });

  it('rejects invalid coordinates', async () => {
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'flood',
      description: 'Water is entering the lower floor.',
      latitude: 120,
      longitude: 74.856,
    });
    expect(response.status).toBe(400);
    expect(response.body.errors.some((error) => error.field === 'latitude')).toBe(true);
  });

  it('rejects an invalid request body', async () => {
    const response = await request(app).post('/api/sos').send({
      emergency_type: 'fire',
      description: 'short',
      location_text: 'Demo site',
      unexpected: true,
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });
});

describe('protected incident operations', () => {
  it('returns incidents to an operator', async () => {
    vi.spyOn(incidentRepository, 'listIncidents').mockResolvedValue({
      incidents: [{ id: incidentId, status: 'pending' }],
      pagination: { page: 1, limit: 20, total: 1, total_pages: 1 },
    });
    const response = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.incidents).toHaveLength(1);
  });

  it('rejects access without authentication', async () => {
    const response = await request(app).get('/api/incidents');
    expect(response.status).toBe(401);
  });

  it('rejects an invalid JWT', async () => {
    const response = await request(app)
      .get('/api/incidents')
      .set('Authorization', 'Bearer not-a-valid-token');
    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/invalid or expired/i);
  });

  it('assigns a rescue team through the protected endpoint', async () => {
    vi.spyOn(assignmentService, 'assignTeam').mockResolvedValue({
      assignment: { incident_id: incidentId, team_id: teamId },
    });
    const response = await request(app)
      .patch(`/api/incidents/${incidentId}/assign`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ team_id: teamId });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Rescue team assigned');
  });

  it('returns 409 for a conflicting assignment', async () => {
    vi.spyOn(assignmentService, 'assignTeam')
      .mockRejectedValue(new AppError(409, 'Incident already has an assignment'));
    const response = await request(app)
      .patch(`/api/incidents/${incidentId}/assign`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ team_id: teamId });
    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });
});
